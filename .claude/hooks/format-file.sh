#!/usr/bin/env bash
# PostToolUse / Write|Edit — форматирование и быстрый линт только что изменённого файла.
#
# Включается сам, когда в Makefile появятся цели (до этого молча пропускает работу):
#   make format-file FILE=<путь от корня>  — отформатировать один файл (oxfmt), тихо;
#   make lint-file   FILE=<путь от корня>  — линт одного файла (oxlint), код ≠ 0 при ошибках.
# Цели должны сами пропускать неподходящие типы файлов и работать за секунды.
# Ошибки линта возвращаются Claude (exit 2): файл уже записан, Claude видит, что поправить.
set -u
. "$(dirname "$0")/lib.sh"
command -v jq >/dev/null || exit 0
hook_read_input
case "$(hook_get '.agent_type')" in critic|reviewer) exit 0 ;; esac
raw=$(hook_get '.tool_input.file_path')
[ -n "$raw" ] || exit 0
root=$(project_root)
p=$(abs_path "$raw")
path_under "$p" "$root" || exit 0
[ -f "$p" ] || exit 0
rel="${p#"$root"/}"
# План задач, настройки агентов, ресерч и макет не форматируем; остальное решают сами цели Makefile.
case "$rel" in tasks/*|.claude/*|research/*|design/*) exit 0 ;; esac

cd "$root" || exit 0
if has_make_target format-file; then
  out=$(make -s format-file FILE="$rel" 2>&1) || {
    printf 'Форматирование %s не удалось (make format-file):\n%s\n' "$rel" "$(tail -n 30 <<<"$out")" >&2
    exit 2
  }
fi
if has_make_target lint-file; then
  out=$(make -s lint-file FILE="$rel" 2>&1) || {
    printf 'Линтер нашёл проблемы в %s — исправь их (не отключай правило без причины и ссылки на задачу):\n%s\n' "$rel" "$(tail -n 40 <<<"$out")" >&2
    exit 2
  }
fi
exit 0
