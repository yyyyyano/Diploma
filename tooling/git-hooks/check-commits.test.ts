// make check-commits (CONSTRAINTS.md «Коммиты»): те же правила, что у хука commit-msg, но по истории ветки —
// ловит коммиты, прошедшие мимо хуков. Проверяется в одноразовом git-репозитории во временной папке.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-commits.mjs", import.meta.url));
let repo = "";

function git(...args: string[]) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: repo, encoding: "utf8" },
  );
}

function commitFile(name: string, lines: number, message: string) {
  writeFileSync(join(repo, name), "x\n".repeat(lines));
  git("add", name);
  git("commit", "-q", "--cleanup=verbatim", "-m", message);
}

function run(...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8" });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "check-commits-"));
  git("init", "-q", "-b", "main");
  commitFile("base.ts", 10, "chore: начальный коммит репозитория");
  git("switch", "-q", "-c", "task/T-000-demo");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("check-commits.mjs", () => {
  it("на ветке без своих коммитов — код 0 и сообщение «проверять нечего»", () => {
    const result = run("main");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("проверять нечего");
  });

  it("чистые коммиты ветки проходят", () => {
    commitFile("a.ts", 20, "feat(tooling): добавить первую проверку");
    commitFile("b.ts", 30, "test(tooling): покрыть проверку тестами");
    const result = run("main");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("в порядке: 2");
  });

  it("коммит с подписью ИИ, длинным заголовком и 900 строками — каждый назван с причиной", () => {
    commitFile(
      "a.ts",
      20,
      "feat: хороший коммит про проверки\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
    );
    commitFile("b.ts", 20, "feat: " + "я".repeat(74));
    commitFile("c.ts", 900, "feat: огромный коммит без причины");
    const result = run("main");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("подпись ИИ");
    expect(result.stderr).toContain("header-max-length");
    expect(result.stderr).toContain("Коммит слишком большой");
  });

  it("история на main сама с собой — пустой диапазон, код 0", () => {
    git("switch", "-q", "main");
    expect(run("main").status).toBe(0);
  });
});
