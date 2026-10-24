#!/usr/bin/env bash
# PreToolUse / Write|Edit|NotebookEdit — для всех.
# 1. Запись вне проекта запрещена всем. Исключения: scratchpad сессии (временные файлы Claude),
#    автопамять проекта ~/.claude/projects/<проект>/ и планы ~/.claude/plans/.
# 2. Всем: нельзя писать в .git/, samples/ (реальные образцы, NFR-18) и файлы .env (секреты, NFR-16).
# 3. critic и reviewer не пишут ничего и нигде, даже в scratchpad: их результат — финальный ответ
#    главной сессии, а не файл (Write/Edit у них и так нет; хук — вторая линия).
# 4. implementer и fixer не меняют правила конвейера, план и планку качества: .claude/ (настройки,
#    хуки, роли, команды, правила, скиллы), CONSTRAINTS.md, tasks/ (план задач), макет design/.
#    Такие изменения делает главная сессия с согласия пользователя (при смене правила — ADR).
# Запись через Bash (`> файл`) этот хук не видит — её ограничивают права и ревью.
set -u
. "$(dirname "$0")/lib.sh"
command -v jq >/dev/null || deny "Хук guard-writes: не найден jq."
hook_read_input
raw=$(hook_get '.tool_input.file_path')
[ -n "$raw" ] || raw=$(hook_get '.tool_input.notebook_path')
[ -n "$raw" ] || exit 0
agent=$(hook_get '.agent_type')
root=$(project_root)
p=$(abs_path "$raw")
rel="${p#"$root"/}"

case "$agent" in
  critic|reviewer)
    deny "Роль $agent только читает: файлов она не пишет (запрошено: $p). Итог — финальным ответом главной сессии; код и документы правят implementer и fixer." ;;
esac

if ! path_under "$p" "$root"; then
  scratch=$(hook_get '.scratchpad_dir')
  [ -n "$scratch" ] && path_under "$p" "$(realpath -m -- "$scratch")" && exit 0
  slug=$(sed 's#[^A-Za-z0-9]#-#g' <<<"$root")
  path_under "$p" "$HOME/.claude/projects/$slug" && exit 0
  path_under "$p" "$HOME/.claude/plans" && exit 0
  deny "Запись вне проекта запрещена: $p. Проект — $root. Временные файлы клади в scratchpad сессии; если правка вне проекта действительно нужна, её делает пользователь."
fi

case "$rel" in
  .git|.git/*) deny "Запись в .git/ запрещена: историей управляют только команды git." ;;
  samples/*|*/samples/*) deny "samples/ — реальные образцы пользователя (NFR-18): их не читают и не меняют агенты. Для тестов — синтетические данные в datasets/." ;;
  .env|*/.env|.env.*|*/.env.*)
    case "$rel" in
      *.env.example) ;;
      *) deny "Файлы .env содержат секреты (NFR-16) и агентам недоступны. Меняй шаблон .env.example." ;;
    esac ;;
esac

case "$agent" in
  implementer|fixer)
    case "$rel" in
      .claude/*|CONSTRAINTS.md|tasks|tasks/*|design/*)
        deny "Роль $agent не меняет $rel: правила конвейера, планку качества, план и макет меняет главная сессия с согласия пользователя (изменение правила — через ADR). Файлов-отчётов не создавай. Опиши нужное изменение в ответе и верни VERDICT: BLOCKED (или ESCALATE)." ;;
    esac ;;
esac
exit 0
