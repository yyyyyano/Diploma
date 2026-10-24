// make lint-file (хук правки файла, CONSTRAINTS.md «Хуки»): файл вне линта — молча пропускается, код выхода 0;
// настоящая ошибка в .ts — красный. Запускается настоящий make в корне репозитория.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const scratch = join(root, "tooling", "__lint_file_scratch__");

function lintFile(file: string) {
  return spawnSync("make", ["--no-print-directory", "lint-file", `FILE=${file}`], {
    cwd: root,
    encoding: "utf8",
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
    mkdirSync(scratch, { recursive: true });
    const file = join("tooling", "__lint_file_scratch__", "bad.ts");
    writeFileSync(join(root, file), "export const x: any = 1;\n");
    const r = lintFile(file);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("no-explicit-any");
  });
});
