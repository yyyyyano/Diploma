#!/usr/bin/env bash
# PreToolUse / Bash — для всех (главная сессия и любые сабагенты).
# Закрывает обход git-хуков и разрушающие git-команды. Это «разумная осторожность» на разборе
# текста команды, а не песочница: настоящая проверка коммитов — git-хуки (lefthook + commitlint),
# публикация дополнительно запрещена правилом permissions.deny в settings.json.
#
# Запрещено:
#   git push — кроме ровно `git push origin main` (NFR-17, решение пользователя 2026-10-31: дирижёр пушит main
#     в origin = yyyyyano/Diploma после каждой принятой задачи; --force, другие ветки и удалённые — запрещены);
#   обход проверок: commit/merge --no-verify, commit -n, LEFTHOOK=0, HUSKY=0, core.hooksPath,
#     COMMIT_MAX_LINES=/COMMIT_WARN_LINES= (порог размера коммита);
#   потеря работы: reset --hard, clean -f, checkout -- <путь> / checkout . / checkout -f,
#     restore (кроме restore --staged), switch -f/--discard-changes/-C, branch -D/-M/-f,
#     stash drop/clear, rm .git;
#   переписывание истории: commit --amend, rebase, filter-branch, filter-repo, update-ref -d,
#     reflog expire/delete.
set -u
. "$(dirname "$0")/lib.sh"
command -v jq >/dev/null || deny "Хук guard-git: не найден jq — без него проверку команд выполнить нельзя."
hook_read_input
cmd=$(hook_get '.tool_input.command')
[ -n "$cmd" ] || exit 0

HINT="Если это действительно нужно — попроси пользователя выполнить команду самому в терминале."

# Есть ли в списке слов $2.. слово, совпадающее с регулярным выражением $1.
has_word() {
  local re="$1" w; shift
  for w in "$@"; do [[ "$w" =~ $re ]] && return 0; done
  return 1
}

# Разбор одной простой команды (слова уже без кавычек).
check_segment() {
  local -a w
  read -ra w <<<"$1"
  local i=0 n=${#w[@]}
  # Префиксы: присваивания VAR=…, обёртки, sudo/env.
  while [ $i -lt $n ]; do
    case "${w[$i]}" in
      [A-Za-z_]*=*) i=$((i+1)) ;;
      sudo|env|command|builtin|nice|nohup|time|exec|noglob|stdbuf) i=$((i+1)) ;;
      timeout) i=$((i+2)) ;;
      -*) [ $i -gt 0 ] && i=$((i+1)) || break ;;  # флаги env/sudo/nice
      *) break ;;
    esac
  done
  [ $i -lt $n ] || return 0
  local prog="${w[$i]##*/}"
  if [ "$prog" = "rm" ]; then
    has_word '(^|/)\.git/?$' "${w[@]:$((i+1))}" && deny "Заблокировано: удаление каталога .git. $HINT"
    return 0
  fi
  [ "$prog" = "git" ] || return 0
  i=$((i+1))
  # Глобальные опции git до подкоманды.
  while [ $i -lt $n ]; do
    case "${w[$i]}" in
      -C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env|--super-prefix) i=$((i+2)) ;;
      -*) i=$((i+1)) ;;
      *) break ;;
    esac
  done
  [ $i -lt $n ] || return 0
  local sub="${w[$i]}"
  local -a a=("${w[@]:$((i+1))}")
  case "$sub" in
    push)
      # NFR-17: разрешён только `git push origin main` — без флагов, других веток и удалённых.
      [ "${#a[@]}" -eq 2 ] && [ "${a[0]}" = "origin" ] && [ "${a[1]}" = "main" ] && return 0
      deny "Заблокировано: git push. Разрешено только «git push origin main» после принятой задачи (NFR-17); --force и другие ветки — нельзя." ;;
    commit)
      has_word '^--no-verify$' "${a[@]}" && deny "Заблокировано: git commit --no-verify. Git-хуки проверки обязательны — исправь причину отказа, а не обходи её."
      has_word '^-[a-zA-Z]*n[a-zA-Z]*$' "${a[@]}" && deny "Заблокировано: git commit -n (то же, что --no-verify). Git-хуки проверки обязательны."
      has_word '^--amend$' "${a[@]}" && deny "Заблокировано: git commit --amend. Историю не переписываем — сделай новый коммит."
      ;;
    merge|cherry-pick|revert|am)
      has_word '^--no-verify$' "${a[@]}" && deny "Заблокировано: --no-verify. Git-хуки проверки обязательны."
      ;;
    reset)
      has_word '^--hard$' "${a[@]}" && deny "Заблокировано: git reset --hard — теряет незакоммиченную работу. $HINT"
      ;;
    clean)
      has_word '^(-[a-zA-Z]*f[a-zA-Z]*|--force)$' "${a[@]}" && deny "Заблокировано: git clean -f — удаляет файлы без возврата. $HINT"
      ;;
    checkout)
      if has_word '^--$' "${a[@]}" || has_word '^\.$' "${a[@]}" || has_word '^(-f|--force|--ours|--theirs|-p|--patch)$' "${a[@]}"; then
        deny "Заблокировано: git checkout с путями или -f отбрасывает изменения. Для веток используй git switch. $HINT"
      fi
      ;;
    restore)
      if ! has_word '^(--staged|-S)$' "${a[@]}" || has_word '^(--worktree|-W)$' "${a[@]}"; then
        deny "Заблокировано: git restore отбрасывает изменения в файлах (разрешено только git restore --staged). $HINT"
      fi
      ;;
    switch)
      has_word '^(-f|--force|--discard-changes|-C|--force-create)$' "${a[@]}" && deny "Заблокировано: git switch с принудительным флагом теряет изменения или перезаписывает ветку. $HINT"
      ;;
    branch)
      has_word '^(-D|-M|-C|-f|--force)$' "${a[@]}" && deny "Заблокировано: принудительное удаление/перезапись ветки. Обычное git branch -d (только слитой ветки) разрешено. $HINT"
      ;;
    stash)
      has_word '^(drop|clear)$' "${a[@]}" && deny "Заблокировано: git stash drop/clear удаляет сохранённую работу. $HINT"
      ;;
    rebase|filter-branch|filter-repo)
      deny "Заблокировано: git $sub переписывает историю. Исправления — новыми коммитами. $HINT" ;;
    update-ref)
      has_word '^(-d|--delete)$' "${a[@]}" && deny "Заблокировано: git update-ref -d. $HINT"
      ;;
    reflog)
      has_word '^(expire|delete)$' "${a[@]}" && deny "Заблокировано: git reflog $sub — уничтожает возможность отката. $HINT"
      ;;
  esac
  return 0
}

# Проверка текста команды; $2 — глубина (bash -c "…" и eval проверяются ещё раз изнутри).
check_text() {
  local text="$1" depth="$2" body stripped seg inner
  body=$(strip_heredocs <<<"$text")
  stripped=$(strip_quotes <<<"$body")

  if grep -Eq '(^|[^[:alnum:]_])git([^[:alnum:]_-]|$)' <<<"$body"; then
    grep -Eq '(^|[[:space:];&|(])(export[[:space:]]+)?(LEFTHOOK|HUSKY)=(0|false)' <<<"$body" \
      && deny "Заблокировано: отключение git-хуков (LEFTHOOK=0/HUSKY=0). Проверки обязательны."
    grep -Eq 'core\.hooks[Pp]ath' <<<"$body" \
      && deny "Заблокировано: подмена core.hooksPath отключает git-хуки. Проверки обязательны."
    grep -Eq '(^|[[:space:];&|(])(export[[:space:]]+)?COMMIT_(MAX|WARN)_LINES=' <<<"$body" \
      && deny "Заблокировано: переопределение порога размера коммита. Большой коммит раздели; исключение — трейлер Large-Commit: <причина>."
    grep -Eq -- '--no-verify' <<<"$stripped" \
      && deny "Заблокировано: --no-verify. Git-хуки проверки обязательны — исправь причину отказа."
  fi

  while IFS= read -r seg; do
    [ -n "${seg// /}" ] || continue
    check_segment "$seg"
  done < <(split_segments <<<"$stripped")

  # Команды, переданные строкой в оболочку: bash -c '…', sh -c "…", eval '…'.
  if [ "$depth" -lt 2 ]; then
    while IFS= read -r inner; do
      [ -n "$inner" ] || continue
      inner=$(sed -E -e "s/^[^'\"]*['\"]//" -e "s/['\"]$//" <<<"$inner")
      check_text "$inner" $((depth+1))
    done < <(grep -oE "(^|[[:space:];&|(])((ba|z|da)?sh([[:space:]]+-[a-zA-Z]+)*[[:space:]]+-[a-zA-Z]*c|eval)[[:space:]]+('[^']*'|\"([^\"\\\\]|\\\\.)*\")" <<<"$body")
  fi
}

check_text "$cmd" 0
exit 0
