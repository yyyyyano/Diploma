#!/usr/bin/env node
// Проверка сообщения коммита: подписи ИИ запрещены (решение пользователя, research/architecture/10-consensus.md).
// Вызывается хуком commit-msg: node tooling/git-hooks/check-no-ai-attribution.mjs <файл-сообщения>
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("check-no-ai-attribution: не передан файл сообщения коммита");
  process.exit(2);
}

// Строки-комментарии git (начинаются с #) в итоговое сообщение не попадают — их не проверяем.
const lines = readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => !line.startsWith("#"));

const FORBIDDEN = [
  /^\s*co-authored-by:.*\b(claude|anthropic|openai|chatgpt|gpt|copilot|gemini|cursor|codex)\b/i,
  /generated (with|by) .*\b(claude|ai|copilot|chatgpt|gemini|cursor|codex)\b/i,
  /noreply@anthropic\.com/i,
  /🤖/u,
];

const bad = lines.filter((line) => FORBIDDEN.some((re) => re.test(line)));
if (bad.length > 0) {
  console.error("\n✖ В сообщении коммита есть подпись ИИ — это запрещено:");
  for (const line of bad) console.error(`    ${line.trim()}`);
  console.error("  Уберите эти строки и повторите коммит.\n");
  process.exit(1);
}
