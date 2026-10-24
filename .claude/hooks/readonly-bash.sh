#!/usr/bin/env bash
# PreToolUse / Bash — только для ролей critic и reviewer.
# Им нужен Bash, чтобы смотреть историю и запускать проверки, но не чтобы что-то менять.
# Белый список команд чтения и проверки; запрет перенаправлений в файлы, подстановок
# $(…)/`…`, флагов «почини/перезапиши» (--fix, --write, -u) и изменяющих git-команд.
# Это «разумная осторожность», а не песочница: make check сам может создавать кэши.
set -u
. "$(dirname "$0")/lib.sh"
command -v jq >/dev/null || deny "Хук readonly-bash: не найден jq."
hook_read_input
agent=$(hook_get '.agent_type')
case "$agent" in critic|reviewer) ;; *) exit 0 ;; esac
cmd=$(hook_get '.tool_input.command')
[ -n "$cmd" ] || exit 0

refuse() {
  deny "Роли $agent разрешены только команды чтения и проверки (git diff/log/show/status, make check|check-quick|check-full|check-commits|deps-check|e2e|lint|typecheck|test…, pnpm test|lint|typecheck|vitest run, ls/cat/head/tail/wc/grep/rg/jq/find…), без записи в файлы. $1
Для поиска по коду удобнее инструменты Grep, Glob и Read."
}

has_word() {
  local re="$1" w; shift
  for w in "$@"; do [[ "$w" =~ $re ]] && return 0; done
  return 1
}

grep -Eq '<<' <<<"$cmd" && refuse "Heredoc в команде не нужен для чтения."
stripped=$(strip_quotes <<<"$cmd")
# Подстановки команд и обратные кавычки.
grep -Eq '\$\(|`' <<<"$stripped" && refuse "Подстановка \$(…) или \`…\` запрещена."
# Безопасные перенаправления убираем, всё остальное с '>' — запись в файл.
norm=$(sed -E -e 's#[0-9]*>&[0-9-]+##g' -e 's#&?[0-9]*>>?[[:space:]]*/dev/null##g' <<<"$stripped")
grep -q '>' <<<"$norm" && refuse "Перенаправление вывода в файл запрещено."

check_git() {
  local -a w=("$@")
  local i=0 n=${#w[@]}
  while [ $i -lt $n ]; do
    case "${w[$i]}" in
      -C) i=$((i+2)) ;;
      --no-pager|-P) i=$((i+1)) ;;
      -*) refuse "Глобальная опция git ${w[$i]} не разрешена." ;;
      *) break ;;
    esac
  done
  [ $i -lt $n ] || return 0
  local sub="${w[$i]}"; local -a a=("${w[@]:$((i+1))}")
  has_word '^--output(=|$)' "${a[@]}" && refuse "git $sub --output пишет в файл."
  case "$sub" in
    diff|log|show|status|blame|ls-files|ls-tree|rev-parse|merge-base|shortlog|describe|cat-file|grep|rev-list|whatchanged|range-diff) return 0 ;;
    branch)
      has_word '^(-d|-D|-m|-M|-c|-C|-f|--force|--delete|--move|--copy|--set-upstream-to.*|-u|--unset-upstream|--edit-description)$' "${a[@]}" \
        && refuse "git branch с изменяющим флагом запрещён."
      if ! has_word '^(--list|-l|--contains|--merged|--no-merged|--points-at)$' "${a[@]}"; then
        local x
        for x in "${a[@]}"; do [[ "$x" == -* ]] || refuse "git branch <имя> создаёт ветку."; done
      fi
      return 0 ;;
    *) refuse "git $sub не входит в разрешённые (только просмотр истории и изменений)." ;;
  esac
}

check_make() {
  local x
  for x in "$@"; do
    case "$x" in
      -s|-k|--no-print-directory|-j|-j[0-9]*|[0-9]*) ;;
      *FIX*=*|*WRITE*=*|*UPDATE*=*) refuse "Переменная $x меняет файлы." ;;
      [A-Z_]*=*) ;;
      # Только читающие проверки (решение пользователя 2026-10-24); check/test-int сами поднимают тестовый Postgres.
      check|check-quick|check-full|check-commits|e2e|lint|typecheck|test|test-*|deps-check|arch-check|format-check|fmt-check|lint-check) ;;
      *) refuse "make $x не входит в разрешённые цели проверки." ;;
    esac
  done
}

check_pnpm() {
  local -a w=("$@")
  local i=0 n=${#w[@]}
  while [ $i -lt $n ]; do
    case "${w[$i]}" in
      -r|--recursive|-s|--silent|--parallel|--no-bail|--if-present) i=$((i+1)) ;;
      --filter|-F|-C|--dir) i=$((i+2)) ;;
      --filter=*|--dir=*) i=$((i+1)) ;;
      *) break ;;
    esac
  done
  [ $i -lt $n ] || refuse "Пустая команда pnpm."
  local sub="${w[$i]}"; local -a a=("${w[@]:$((i+1))}")
  [ "$sub" = "exec" ] && { sub="${a[0]:-}"; a=("${a[@]:1}"); }
  has_word '^(--fix|--fix-.*|--write|-w|-u|--update|--watch|--ui)$' "${a[@]}" && refuse "Флаг правки/наблюдения запрещён ревью-ролям."
  case "$sub" in
    test|lint|typecheck|depcruise|oxlint|tsc|tsgo|list|ls|why|outdated|audit) return 0 ;;
    vitest)
      [ "${a[0]:-}" = "run" ] || [ "${a[0]:-}" = "list" ] || refuse "Только vitest run (без режима наблюдения)."
      return 0 ;;
    *) refuse "pnpm $sub не входит в разрешённые." ;;
  esac
}

check_segment() {
  local -a w
  read -ra w <<<"$1"
  local i=0 n=${#w[@]}
  while [ $i -lt $n ]; do
    case "${w[$i]}" in
      CI=*|NODE_ENV=*|FORCE_COLOR=*|NO_COLOR=*|TZ=*|LANG=*|LC_ALL=*) i=$((i+1)) ;;
      [A-Za-z_]*=*) refuse "Присваивание ${w[$i]%%=*}=… перед командой не разрешено." ;;
      timeout) i=$((i+2)) ;;
      *) break ;;
    esac
  done
  [ $i -lt $n ] || return 0
  local prog="${w[$i]}"; local -a a=("${w[@]:$((i+1))}")
  case "$prog" in
    git) check_git "${a[@]}" ;;
    make) check_make "${a[@]}" ;;
    pnpm) check_pnpm "${a[@]}" ;;
    npx|node|npm|bash|sh|zsh|eval|source|.|python|python3|xargs|awk|sed|perl|env|sudo)
      refuse "$prog может выполнять произвольный код или менять файлы." ;;
    find)
      has_word '^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$' "${a[@]}" && refuse "find с -exec/-delete/-fprint запрещён." ;;
    sort|tree)
      has_word '^(-o|--output.*)$' "${a[@]}" && refuse "$prog -o пишет в файл." ;;
    uniq)
      local x; for x in "${a[@]}"; do [[ "$x" == -* ]] || refuse "uniq с файлом-выходом запрещён; используй в конвейере."; done ;;
    tail)
      has_word '^(-f|-F|--follow.*)$' "${a[@]}" && refuse "tail -f не завершается." ;;
    rg)
      has_word '^--pre(=|$)' "${a[@]}" && refuse "rg --pre выполняет команды." ;;
    ls|cat|head|wc|grep|egrep|fgrep|jq|nl|diff|cmp|file|stat|pwd|echo|printf|du|basename|dirname|realpath|readlink|cut|tr|column|which|true|false|cd|date|test|\[) ;;
    *) refuse "Команда «$prog» вне белого списка." ;;
  esac
}

while IFS= read -r seg; do
  [ -n "${seg// /}" ] || continue
  check_segment "$seg"
done < <(split_segments <<<"$norm")
exit 0
