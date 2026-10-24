#!/usr/bin/env bash
# SubagentStop / implementer|fixer — гейт «готово = проверки зелёные».
# Фраза «тесты прошли» в отчёте ничего не стоит: гейт сам запускает `make check`.
#   • красный make check → агент не завершается, получает хвост вывода и чинит причину;
#   • незакоммиченные изменения (кроме tasks/plan.md — статус задачи ведёт оркестратор) →
#     агент должен закоммитить или убрать их.
# Пропускает работу:
#   • если цели `check` в Makefile ещё нет (появится в «бетонной» фазе — гейт включится сам);
#   • если агент остановился с VERDICT: BLOCKED / ESCALATE (он и не заявляет готовность);
#   • на повторной остановке после блока (stop_hook_active) — чтобы не зациклиться; итог всё равно
#     перепроверяют оркестратор и ревьюер.
set -u
. "$(dirname "$0")/lib.sh"
command -v jq >/dev/null || { echo "gate-impl: нет jq, гейт пропущен" >&2; exit 0; }
hook_read_input
[ "$(hook_get '.stop_hook_active')" = "true" ] && exit 0
msg=$(hook_get '.last_assistant_message')
grep -Eq 'VERDICT:[[:space:]]*(BLOCKED|ESCALATE)' <<<"$msg" && exit 0

root=$(project_root)
cd "$root" || exit 0
problems=""

if git rev-parse --git-dir >/dev/null 2>&1; then
  dirty=$(git status --porcelain=v1 --untracked-files=all | grep -Ev '^.. tasks/plan\.md$' || true)
  if [ -n "$dirty" ]; then
    problems+="Есть незакоммиченные изменения (каждый законченный шаг — коммит; лишнее — убери):
$(head -n 20 <<<"$dirty")
"
  fi
fi

if has_make_target check; then
  if ! out=$(make check 2>&1); then
    problems+="make check красный. Найди и исправь причину; не ослабляй проверки (skip, @ts-ignore, отключённые правила, сниженные пороги запрещены — CONSTRAINTS.md).
Хвост вывода:
$(tail -n 60 <<<"$out")
"
  fi
fi

[ -z "$problems" ] && exit 0
printf 'Нельзя завершать работу с VERDICT: DONE, пока:\n%s\nЕсли исправить не получается — опиши причину в ответе и верни VERDICT: BLOCKED (или ESCALATE, если нужно решение).\n' "$problems" >&2
exit 2
