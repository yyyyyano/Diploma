// «Пол» CONSTRAINTS.md: то, что Oxlint не ловит или ловит без проверки причины, — floor.mjs на фикстурах:
// отключённые и выборочные тесты, подавления проверок без «почему + ID задачи», TODO без ID, «Not implemented».
// Пустой catch, .skip/.only в Vitest и @ts-ignore ловит ещё и Oxlint (.oxlintrc.json); закомментированный код и
// catch, глотающий ошибку, остаются ревью.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIN_FILES, runFloor } from "./floor.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = join(repoRoot, "tooling/architecture/fixtures/checks/floor");
const script = fileURLToPath(new URL("./floor.mjs", import.meta.url));
const recognize = "apps/server/src/modules/receipts/application/recognize.ts";

function found(baseDir: string): string[] {
  return runFloor({ baseDir, minFiles: 1 }).findings.map((f) => `${f.file}:${f.line} ${f.rule}`);
}

describe("floor: нарушения «Пола» на фикстуре", () => {
  const violations = found(join(fixtures, "violation"));

  it("it.fails, it.todo, it.skipIf, describe.only, test.fixme, test.describe.skip, xit", () => {
    expect(violations).toEqual(
      expect.arrayContaining([
        "packages/calc/src/sum.test.ts:4 disabled-test",
        "packages/calc/src/sum.test.ts:5 disabled-test",
        "packages/calc/src/sum.test.ts:6 disabled-test",
        "packages/calc/src/sum.test.ts:7 disabled-test",
        "e2e/specs/import.spec.ts:1 disabled-test",
        "e2e/specs/import.spec.ts:2 disabled-test",
        "e2e/specs/import.spec.ts:3 disabled-test",
      ]),
    );
  });

  it("подавления без причины: oxlint/eslint-disable, istanbul, v8, c8 ignore, @ts-ignore, @ts-nocheck, @ts-expect-error вне тестов", () => {
    expect(violations).toEqual(
      expect.arrayContaining([
        `${recognize}:1 suppression`,
        `${recognize}:3 suppression`,
        `${recognize}:5 suppression`,
        `${recognize}:10 suppression`,
        "apps/web/src/app/App.tsx:1 suppression",
        "packages/kernel/src/scope.ts:1 suppression",
        "tooling/gen.mjs:1 suppression",
        "tooling/gen.mjs:2 suppression",
      ]),
    );
  });

  it("TODO, FIXME и XXX без ID задачи и «Not implemented»", () => {
    expect(violations).toEqual(
      expect.arrayContaining([
        `${recognize}:6 todo-without-id`,
        `${recognize}:7 todo-without-id`,
        "tooling/gen.mjs:3 todo-without-id",
        `${recognize}:8 not-implemented`,
      ]),
    );
  });

  it("ничего лишнего: ровно 19 нарушений, код 1, сообщение называет, что исправить", () => {
    const result = runFloor({ baseDir: join(fixtures, "violation"), minFiles: 1 });
    expect({ code: result.code, count: violations.length }).toEqual({ code: 1, count: 19 });
    expect(result.messages).toContain(
      `${recognize}:6 — «TODO» без ID задачи (CONSTRAINTS «Пол»): напишите TODO(T-034): … ` +
        "с номером задачи или доделайте сейчас.",
    );
  });
});

describe("floor: законный код не ловится", () => {
  it("причина с ID рядом, TODO(T-034), @ts-expect-error с пояснением в тесте, метки в строках и регэкспах — чисто", () => {
    const result = runFloor({ baseDir: join(fixtures, "clean"), minFiles: 1 });
    expect({ code: result.code, files: result.files, findings: result.findings }).toEqual({
      code: 0,
      files: 3,
      findings: [],
    });
  });

  it("проверено меньше порога — код 2, даже без нарушений", () => {
    const result = runFloor({ baseDir: join(fixtures, "clean"), minFiles: 4 });
    expect(result.code).toBe(2);
    expect(result.messages.join("\n")).toContain("меньше порога 4");
  });
});

describe("floor на репозитории", () => {
  it("make static-checks: текущее дерево чистое и проверено не меньше MIN_FILES файлов", () => {
    const run = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: "utf8" });
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: "" });
    const files = Number(/проверено файлов: (\d+)/.exec(run.stdout)?.[1]);
    expect(files).toBeGreaterThanOrEqual(MIN_FILES);
  });
});
