#!/usr/bin/env bash
# Самопроверка хуков: прогон на тестовых JSON-входах с ожидаемыми кодами выхода.
# Запуск: .claude/hooks/selftest.sh   (ничего не меняет в проекте: гейты гоняются во временной копии)
# Выход: 0 — все случаи совпали; 1 — есть расхождения (они напечатаны).
set -u
H="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$H/../.." && pwd)"
fail=0; total=0

# run <ожидаемый код> <скрипт> <описание> <json>
run() {
  local want="$1" script="$2" name="$3" json="$4" got
  total=$((total+1))
  CLAUDE_PROJECT_DIR="${PROJ:-$ROOT}" "$H/$script" <<<"$json" >/dev/null 2>"$TMP/err"
  got=$?
  if [ "$got" != "$want" ]; then
    fail=$((fail+1))
    printf 'НЕ СОВПАЛО  %-18s %-55s ждали %s, получили %s: %s\n' "$script" "$name" "$want" "$got" "$(head -c 200 "$TMP/err" | tr '\n' ' ')"
  fi
}

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# Вход PreToolUse/Bash: bash_in <agent_type|""> <команда>
bash_in() { jq -cn --arg a "$1" --arg c "$2" --arg cwd "$ROOT" \
  '{hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$cwd,tool_input:{command:$c}} + (if $a=="" then {} else {agent_type:$a} end)'; }
write_in() { jq -cn --arg a "$1" --arg p "$2" --arg cwd "$ROOT" --arg s "/tmp/claude-test-scratch" \
  '{hook_event_name:"PreToolUse",tool_name:"Write",cwd:$cwd,scratchpad_dir:$s,tool_input:{file_path:$p,content:"x"}} + (if $a=="" then {} else {agent_type:$a} end)'; }

# --- guard-git.sh: разрешено ---
for c in 'git status' 'git log --oneline -5' 'git diff main...HEAD' \
  'git commit -m "feat(receipts): проверять арифметику чека"' \
  'git commit -m "fix: не делать git push и reset --hard"' \
  "git commit -F - <<'EOF'
fix: убрать --no-verify из скрипта

git push и git reset --hard здесь только текст.
EOF" \
  'git switch -c task/T-001-gates' 'git merge --ff-only task/T-001-gates' 'git branch -d task/T-001-x' \
  'git restore --staged src/a.ts' 'git checkout main' 'git add src/a.ts && git commit -m "test: x"' \
  'echo "git push"' 'grep -rn "reset --hard" .' 'make check' 'git -C apps/web status' \
  'git log --grep=push' 'ls -la | head'; do
  run 0 guard-git.sh "можно: ${c:0:50}" "$(bash_in "" "$c")"
done
# --- guard-git.sh: запрещено ---
for c in 'git push' 'git push origin main' 'git -C . push' 'git -c push.default=current push' \
  'FOO=1 git push' 'git status && git push' 'bash -c "git push origin main"' "sh -c 'git push'" \
  'eval "git push"' 'git commit --no-verify -m "x"' 'git commit -nm "x"' 'git commit -am x -n' \
  'LEFTHOOK=0 git commit -m "x"' 'HUSKY=0 git commit -m x' 'git -c core.hooksPath=/dev/null commit -m x' \
  "git -c 'core.hooksPath=x' commit -m y" 'COMMIT_MAX_LINES=5000 git commit -m x' \
  'git commit --amend --no-edit' 'git reset --hard HEAD~1' 'git clean -fd' 'git clean --force' \
  'git checkout -- src/a.ts' 'git checkout .' 'git checkout -f main' 'git restore src/a.ts' \
  'git restore --staged --worktree a.ts' 'git switch -f main' 'git switch --discard-changes main' \
  'git branch -D task/x' 'git stash drop' 'git stash clear' 'git rebase main' 'git rebase -i HEAD~3' \
  'git filter-branch --all' 'git update-ref -d refs/heads/x' 'git reflog expire --all' 'rm -rf .git' \
  'git merge --no-verify x' 'timeout 60 git push'; do
  run 2 guard-git.sh "нельзя: ${c:0:50}" "$(bash_in "" "$c")"
done
run 0 guard-git.sh "пустая команда" '{"tool_input":{}}'

# --- readonly-bash.sh ---
for a in critic reviewer; do
  for c in 'git diff main...HEAD' 'git log --oneline main..HEAD' 'git show HEAD --stat' 'git status --porcelain' \
    'git branch --show-current' 'git -C apps/web log -3' 'make check' 'make -s test-unit' 'make check 2>&1 | tail -n 50' \
    'pnpm vitest run apps/server/src/modules/receipts' 'pnpm --filter @kosht/calc test' 'pnpm exec oxlint apps/web' \
    'ls -la tasks' 'cat CONSTRAINTS.md | head -n 40' 'grep -rn "@ts-ignore" apps | wc -l' \
    'grep -rn "a|b" src' 'git diff --stat main...HEAD -- apps/server' 'find apps -name "*.test.ts"' \
    'git log --format="%h %s%n%b" main..HEAD' 'wc -l $(echo x)' ; do
    want=0; case "$c" in *'$('*) want=2 ;; esac
    run $want readonly-bash.sh "$a можно: ${c:0:45}" "$(bash_in "$a" "$c")"
  done
  for c in 'git commit -m x' 'git add .' 'git checkout main' 'git branch new-branch' 'git stash' \
    'echo x > src/a.ts' 'cat a >> b' 'git diff > /tmp/d.patch' 'ls 2> err.log' 'tee out.txt' \
    'sed -i s/a/b/ f' 'rm -rf src' 'mv a b' 'cp a b' 'npx vitest' 'node -e "1"' 'bash -c "ls"' \
    'pnpm exec oxlint --fix apps' 'pnpm vitest' 'pnpm vitest run -u' 'pnpm install' 'make up' 'make db-reset' \
    'find . -name x -delete' 'find . -exec rm {} \;' 'sort -o out.txt in.txt' 'git diff --output=x.patch' \
    'awk "{print}" f' 'FOO=1 make check' 'cat <<EOF
x
EOF' 'curl https://example.com' 'git log $(rm -rf x)'; do
    run 2 readonly-bash.sh "$a нельзя: ${c:0:45}" "$(bash_in "$a" "$c")"
  done
done
for a in "" implementer fixer Explore; do
  run 0 readonly-bash.sh "не роль-чтение ($a): echo > f" "$(bash_in "$a" 'echo x > f.txt')"
done

# --- guard-writes.sh ---
run 0 guard-writes.sh "главная: файл проекта" "$(write_in "" "$ROOT/apps/web/src/a.ts")"
run 0 guard-writes.sh "главная: относительный путь" "$(write_in "" "apps/web/src/a.ts")"
run 2 guard-writes.sh "главная: вне проекта" "$(write_in "" "/home/user/University/CLAUDE.md")"
run 2 guard-writes.sh "главная: обход ../" "$(write_in "" "$ROOT/../other/x.md")"
run 2 guard-writes.sh "главная: /etc" "$(write_in "" "/etc/hosts")"
run 0 guard-writes.sh "главная: scratchpad" "$(write_in "" "/tmp/claude-test-scratch/notes.md")"
run 0 guard-writes.sh "главная: автопамять проекта" "$(write_in "" "$HOME/.claude/projects/$(sed 's#[^A-Za-z0-9]#-#g' <<<"$ROOT")/memory/x.md")"
run 2 guard-writes.sh "главная: чужая автопамять" "$(write_in "" "$HOME/.claude/projects/-home-user-other/memory/x.md")"
run 2 guard-writes.sh "все: .env" "$(write_in "" "$ROOT/.env")"
run 2 guard-writes.sh "все: .env.local" "$(write_in "" "$ROOT/apps/server/.env.local")"
run 0 guard-writes.sh "все: .env.example" "$(write_in "implementer" "$ROOT/.env.example")"
run 2 guard-writes.sh "все: samples/" "$(write_in "implementer" "$ROOT/samples/belarusbank.pdf")"
run 2 guard-writes.sh "все: .git/" "$(write_in "" "$ROOT/.git/hooks/commit-msg")"
for a in critic reviewer; do
  run 2 guard-writes.sh "$a: бывший отчёт в tasks/reports" "$(write_in "$a" "$ROOT/tasks/reports/T-001/01-critic.md")"
  run 2 guard-writes.sh "$a: код" "$(write_in "$a" "$ROOT/apps/web/src/a.ts")"
  run 2 guard-writes.sh "$a: план" "$(write_in "$a" "$ROOT/tasks/plan.md")"
  run 2 guard-writes.sh "$a: SPEC.md" "$(write_in "$a" "$ROOT/SPEC.md")"
  run 2 guard-writes.sh "$a: scratchpad" "$(write_in "$a" "/tmp/claude-test-scratch/notes.md")"
  run 2 guard-writes.sh "$a: относительный путь" "$(write_in "$a" "notes.md")"
done
for a in implementer fixer; do
  run 0 guard-writes.sh "$a: код" "$(write_in "$a" "$ROOT/apps/server/src/modules/receipts/domain/x.ts")"
  run 0 guard-writes.sh "$a: паспорт модуля" "$(write_in "$a" "$ROOT/apps/server/src/modules/receipts/CLAUDE.md")"
  run 0 guard-writes.sh "$a: SPEC.md (по решению пользователя)" "$(write_in "$a" "$ROOT/SPEC.md")"
  run 0 guard-writes.sh "$a: scratchpad" "$(write_in "$a" "/tmp/claude-test-scratch/notes.md")"
  run 2 guard-writes.sh "$a: файл-отчёт в tasks/reports" "$(write_in "$a" "$ROOT/tasks/reports/T-001/02-impl.md")"
  run 2 guard-writes.sh "$a: план" "$(write_in "$a" "$ROOT/tasks/plan.md")"
  run 2 guard-writes.sh "$a: settings.json" "$(write_in "$a" "$ROOT/.claude/settings.json")"
  run 2 guard-writes.sh "$a: правило" "$(write_in "$a" "$ROOT/.claude/rules/testing.md")"
  run 2 guard-writes.sh "$a: хук" "$(write_in "$a" "$ROOT/.claude/hooks/guard-git.sh")"
  run 2 guard-writes.sh "$a: CONSTRAINTS.md" "$(write_in "$a" "$ROOT/CONSTRAINTS.md")"
  run 2 guard-writes.sh "$a: обход ../ в план" "$(write_in "$a" "$ROOT/apps/../tasks/plan.md")"
  run 2 guard-writes.sh "$a: макет" "$(write_in "$a" "$ROOT/design/tokens.css")"
done
run 0 guard-writes.sh "без пути" '{"tool_input":{}}'

# --- гейты: во временном git-репозитории ---
PROJ="$TMP/proj"; mkdir -p "$PROJ/tasks"
git -C "$PROJ" init -q -b main && git -C "$PROJ" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
stop_in() { jq -cn --arg a "$1" --arg m "$2" --argjson s "${3:-false}" --arg cwd "$PROJ" \
  '{hook_event_name:"SubagentStop",agent_type:$a,cwd:$cwd,stop_hook_active:$s,last_assistant_message:$m}'; }

run 0 gate-impl.sh "нет Makefile — пропуск" "$(stop_in implementer 'VERDICT: DONE')"
printf 'lint:\n\t@true\n' >"$PROJ/Makefile"; git -C "$PROJ" add Makefile; git -C "$PROJ" -c user.email=t@t -c user.name=t commit -qm mk
run 0 gate-impl.sh "нет цели check — пропуск" "$(stop_in implementer 'VERDICT: DONE')"
printf 'lint check:\n\t@true\n' >"$PROJ/Makefile"; git -C "$PROJ" -c user.email=t@t -c user.name=t commit -qam mk2
run 0 gate-impl.sh "check зелёный" "$(stop_in implementer 'VERDICT: DONE')"
printf 'check:\n\t@echo "1 test failed"; exit 1\n' >"$PROJ/Makefile"; git -C "$PROJ" -c user.email=t@t -c user.name=t commit -qam mk3
run 2 gate-impl.sh "check красный — блок" "$(stop_in implementer 'VERDICT: DONE')"
run 2 gate-impl.sh "check красный — блок (fixer)" "$(stop_in fixer 'VERDICT: DONE')"
run 2 gate-impl.sh "check красный, прежний NEEDS_USER — блок" "$(stop_in implementer 'VERDICT: NEEDS_USER')"
run 0 gate-impl.sh "check красный, повторная остановка" "$(stop_in implementer 'VERDICT: DONE' true)"
run 0 gate-impl.sh "check красный, BLOCKED" "$(stop_in implementer 'VERDICT: BLOCKED
причина')"
run 0 gate-impl.sh "check красный, ESCALATE" "$(stop_in fixer 'VERDICT: ESCALATE')"
run 0 gate-impl.sh "check красный, BLOCKED (fixer)" "$(stop_in fixer 'VERDICT: BLOCKED')"
run 0 gate-impl.sh "check красный, ESCALATE (implementer)" "$(stop_in implementer 'VERDICT: ESCALATE
Вопрос: А или Б')"
printf 'check:\n\t@true\n' >"$PROJ/Makefile"; git -C "$PROJ" -c user.email=t@t -c user.name=t commit -qam mk4
printf '### T-001 · x\n- Статус: todo\n' >"$PROJ/tasks/plan.md"
git -C "$PROJ" add tasks/plan.md; git -C "$PROJ" -c user.email=t@t -c user.name=t commit -qm plan
printf '### T-001 · x\n- Статус: in-progress\n' >"$PROJ/tasks/plan.md"
run 0 gate-impl.sh "незакоммичен статус в tasks/plan.md" "$(stop_in implementer 'VERDICT: DONE')"
mkdir -p "$PROJ/tasks/reports/T-001"; echo x >"$PROJ/tasks/reports/T-001/02-impl.md"
run 2 gate-impl.sh "файл-отчёт в tasks/reports — блок" "$(stop_in implementer 'VERDICT: DONE')"
rm -rf "$PROJ/tasks/reports"
echo x >"$PROJ/tasks/todo.md"
run 2 gate-impl.sh "посторонний файл в tasks/ — блок" "$(stop_in fixer 'VERDICT: DONE')"
rm "$PROJ/tasks/todo.md"
echo x >"$PROJ/new.ts"
run 2 gate-impl.sh "незакоммиченный код — блок" "$(stop_in implementer 'VERDICT: DONE')"
rm "$PROJ/new.ts"

# --- format-file.sh ---
fmt_in() { jq -cn --arg a "$1" --arg p "$2" --arg cwd "$PROJ" '{hook_event_name:"PostToolUse",tool_name:"Edit",agent_type:$a,cwd:$cwd,tool_input:{file_path:$p}}'; }
mkdir -p "$PROJ/src"; echo 'x' >"$PROJ/src/a.ts"
run 0 format-file.sh "нет целей — пропуск" "$(fmt_in implementer "$PROJ/src/a.ts")"
printf 'check:\n\t@true\nformat-file:\n\t@true\nlint-file:\n\t@echo "$(FILE): no-unused-vars"; exit 1\n' >"$PROJ/Makefile"
run 2 format-file.sh "линт красный — сообщение Claude" "$(fmt_in implementer "$PROJ/src/a.ts")"
run 0 format-file.sh "ревьюер — пропуск" "$(fmt_in reviewer "$PROJ/src/a.ts")"
run 0 format-file.sh "вне проекта — пропуск" "$(fmt_in implementer "/etc/hosts")"
printf 'format-file:\n\t@true\nlint-file:\n\t@true\n' >"$PROJ/Makefile"
run 0 format-file.sh "линт зелёный" "$(fmt_in implementer "$PROJ/src/a.ts")"

# --- конфигурация: settings.json и роли ---
# check <описание> <команда…>: команда должна завершиться успешно.
check() {
  local name="$1"; shift
  total=$((total+1))
  if ! "$@" >/dev/null 2>&1; then
    fail=$((fail+1)); printf 'НЕ СОВПАЛО  %-18s %s\n' "config" "$name"
  fi
}
S="$ROOT/.claude/settings.json"
check "settings.json — корректный JSON" jq -e . "$S"
check "attribution пустой (без подписей ИИ)" jq -e '.attribution.commit == "" and .attribution.pr == ""' "$S"
check "нет разрешений на tasks/reports" jq -e '[.permissions.allow[] | select(test("tasks/reports"))] | length == 0' "$S"
check "git push запрещён в deny" jq -e '.permissions.deny | index("Bash(git push *)") != null' "$S"
check "gate-report.sh не зарегистрирован" jq -e '[.. | strings | select(test("gate-report"))] | length == 0' "$S"
while IFS= read -r c; do
  f="${c//\$\{CLAUDE_PROJECT_DIR\}/$ROOT}"
  check "хук из settings есть и исполняемый: ${f#"$ROOT"/}" test -x "$f"
done < <(jq -r '.hooks[][].hooks[].command' "$S")
check "gate-report.sh удалён" test ! -e "$H/gate-report.sh"
for a in critic reviewer; do
  check "$a: в tools нет Write/Edit/NotebookEdit" bash -c "grep -m1 '^tools:' '$ROOT/.claude/agents/$a.md' | grep -qv -E 'Write|Edit'"
done
check "в конвейере нет ссылок на tasks/reports, todo.md, шаблоны" bash -c "! grep -rqE 'tasks/(reports|templates|README|todo)|todo\.md|gate-report' '$ROOT/.claude/agents' '$ROOT/.claude/commands/task-cycle.md' '$S'"
check "tasks/README.md и tasks/templates/ удалены" bash -c "[ ! -e '$ROOT/tasks/README.md' ] && [ ! -e '$ROOT/tasks/templates' ]"

echo "Хуки: $((total-fail)) из $total случаев совпали с ожиданием."
[ "$fail" -eq 0 ]
