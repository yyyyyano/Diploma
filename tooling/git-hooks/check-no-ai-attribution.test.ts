// Запрет подписей ИИ в сообщении коммита (корневой CLAUDE.md «Git»): скрипт запускается как в хуке
// commit-msg — дочерним процессом на файлах-фикстурах сообщений.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-no-ai-attribution.mjs", import.meta.url));

function run(fixture: string) {
  const file = fileURLToPath(new URL(`./__fixtures__/${fixture}`, import.meta.url));
  return spawnSync(process.execPath, [script, file], { encoding: "utf8" });
}

describe("check-no-ai-attribution.mjs", () => {
  it("строка Co-Authored-By: Claude отклоняется и названа в сообщении", () => {
    const result = run("co-authored-by-claude.txt");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("подпись ИИ");
    expect(result.stderr).toContain("Co-Authored-By: Claude Opus");
  });

  it("строка «Generated with Claude Code» отклоняется", () => {
    const result = run("generated-with.txt");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Generated with Claude Code");
  });

  it("эмодзи 🤖 отклоняется", () => {
    expect(run("robot-emoji.txt").status).toBe(1);
  });

  it("обычное сообщение с соавтором-человеком проходит", () => {
    const result = run("clean.txt");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("строки-комментарии git (#) не проверяются — они не попадают в коммит", () => {
    expect(run("git-comment.txt").status).toBe(0);
  });

  it("без файла сообщения — код 2", () => {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.status).toBe(2);
  });
});
