# Общие функции хуков «Кошта». Подключается через `source`, сам не запускается.
# Зависимости: bash 4+, jq, coreutils (realpath). Внешних пакетов нет.

# Вход хука (JSON со stdin) читается один раз в переменную HOOK_INPUT.
hook_read_input() {
  HOOK_INPUT=$(cat)
}

# Поле из входа хука: hook_get '.tool_input.command'
hook_get() {
  jq -r "$1 // empty" <<<"$HOOK_INPUT" 2>/dev/null
}

# Корень проекта: CLAUDE_PROJECT_DIR, иначе cwd из входа, иначе текущий каталог.
project_root() {
  local r="${CLAUDE_PROJECT_DIR:-}"
  [ -n "$r" ] || r=$(hook_get '.cwd')
  [ -n "$r" ] || r=$PWD
  realpath -m -- "$r"
}

# Абсолютный нормализованный путь (с разворотом ../ и ссылок существующих частей).
# Относительный путь считается от cwd из входа хука.
abs_path() {
  local p="$1" base
  base=$(hook_get '.cwd')
  [ -n "$base" ] || base=$PWD
  case "$p" in
    /*) ;;
    "~"/*) p="$HOME/${p#\~/}" ;;
    *) p="$base/$p" ;;
  esac
  realpath -m -- "$p"
}

# Лежит ли путь $1 внутри каталога $2 (или совпадает с ним).
path_under() {
  local p="$1" d="${2%/}"
  [ -n "$d" ] || return 1
  [ "$p" = "$d" ] && return 0
  case "$p" in "$d"/*) return 0 ;; esac
  return 1
}

# Есть ли в Makefile проекта цель $1. Ищем в Makefile и подключаемых *.mk
# (корень и make/). Цель «появляется» сама, как только её допишут в Makefile.
has_make_target() {
  local root t="$1" files=()
  root=$(project_root)
  [ -f "$root/Makefile" ] || return 1
  files=("$root/Makefile")
  local f
  for f in "$root"/*.mk "$root"/make/*.mk; do
    [ -f "$f" ] && files+=("$f")
  done
  grep -Eqs "^([^:#=[:space:]]+[[:space:]]+)*${t}([[:space:]]+[^:#=[:space:]]+)*[[:space:]]*::?([^=]|$)" "${files[@]}"
}

# Блокирующий отказ: текст уходит Claude, код выхода 2.
deny() {
  printf '%s\n' "$*" >&2
  exit 2
}

# Убрать тела heredoc (строки между `<<EOF` и `EOF`): в них текст, а не команды.
strip_heredocs() {
  awk '
    BEGIN { delim = "" }
    {
      if (delim != "") {
        line = $0; sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line)
        if (line == delim) { delim = "" }
        next
      }
      print
      s = $0
      if (match(s, /<<-?[ \t]*["\047]?[A-Za-z_][A-Za-z0-9_]*["\047]?/)) {
        d = substr(s, RSTART, RLENGTH)
        sub(/^<<-?[ \t]*/, "", d); gsub(/["\047]/, "", d)
        if (substr(s, RSTART + 2, 1) != "<") delim = d
      }
    }'
}

# Заменить содержимое строк в кавычках на Q: сообщения коммитов и шаблоны grep не должны
# приниматься за команды. Порядок: сначала двойные кавычки (с экранированием), затем одинарные.
strip_quotes() {
  sed -E -e 's/"([^"\\]|\\.)*"/Q/g' -e "s/'[^']*'/Q/g"
}

# Разбить командную строку на простые команды по ; && || | & ( ) ` $( и переводам строк.
split_segments() {
  sed -E -e 's/\$\(/\n/g' -e 's/(\|\||&&|;|\||&|\(|\)|`)/\n/g'
}
