// make lint-file (хук правки файла, CONSTRAINTS.md «Хуки»): файл вне линта — молча пропускается, код выхода 0;
// настоящая ошибка в .ts — красный. Запускается настоящий make в корне репозитория.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
// Временный файл — вне репозитория: соседние тесты параллельно обходят настоящее дерево (deps-guard, «Пол»,
// раскладка pnpm в rules.fixtures) и падали с ENOENT, увидев файл, который этот тест уже удалил.
// oxlint берёт .oxlintrc.json из cwd (корень репозитория), так что правила проекта действуют и на него.
const scratch = mkdtempSync(join(tmpdir(), "kosht-lint-file-"));

// Окружение как у человека в терминале: без переменных агентов. Часть CLI (oxlint) меняет вывод под агентом
// (AI_AGENT, CLAUDECODE), и тест, зависящий от этого, красный у человека и зелёный у агента.
function humanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "AI_AGENT" || key === "CLAUDECODE" || key.startsWith("CLAUDE_")) delete env[key];
  }
  return env;
}

function lintFile(file: string) {
  return spawnSync("make", ["--no-print-directory", "lint-file", `FILE=${file}`], {
    cwd: root,
    encoding: "utf8",
    env: humanEnv(),
  });
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("make lint-file", () => {
  // Файлы под ignorePatterns (.oxlintrc.json) — oxlint без флага падает «No files found».
  it.each(["docs/x.ts", "data/y.ts", ".claude/hooks/x.mjs", "samples/z.ts"])(
    "молча пропускает %s, код 0",
    (file) => {
      const r = lintFile(file);
      expect({ status: r.status, out: r.stdout + r.stderr }).toEqual({ status: 0, out: "" });
    },
  );

  it("пропускает файл не того типа (.md), код 0", () => {
    expect(lintFile("README.md").status).toBe(0);
  });

  it("настоящая ошибка линтера в .ts остаётся красной", () => {
    const file = join(scratch, "bad.ts");
    writeFileSync(file, "export const x: any = 1;\n");
    const r = lintFile(file);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("no-explicit-any");
  });
});
