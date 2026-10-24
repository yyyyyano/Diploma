// P1 и ARCHITECTURE §2: packages/calc — чистые функции без времени, случайности и среды. calc-no-clock.mjs
// на фикстурах: каждое обращение к часам называет строку; дата аргументом, строки, комментарии, тесты и
// kernel (LocalDate по Минску законно использует Intl) не ловятся.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCalcNoClock } from "./calc-no-clock.mjs";

const fixtures = fileURLToPath(
  new URL("../architecture/fixtures/checks/calc-no-clock/", import.meta.url),
);

describe("calc-no-clock: время, случайность и среда в calc", () => {
  it("new Date(), Date.now, Math.random, Intl, performance.now, crypto, new Date без скобок, Temporal.Now, импорт node:crypto и perf_hooks — по строке", () => {
    const result = runCalcNoClock({ baseDir: join(fixtures, "violation") });
    expect(result.code).toBe(1);
    expect(result.findings.map((f) => `${f.line} ${f.message.split("»")[0]}»`)).toEqual([
      "2 найдено «new Date()»",
      "4 найдено «Date.now»",
      "5 найдено «Math.random»",
      "6 найдено «Intl»",
      "7 найдено «performance.now»",
      "8 найдено «crypto.randomUUID»",
      "9 найдено «new Date»",
      "10 найдено «Temporal.Now»",
      '11 найдено «from "node:crypto"»',
      '12 найдено «from "perf_hooks"»',
      '13 найдено «import("node:crypto"»',
    ]);
  });

  it("сообщение говорит, что сделать: передать дату аргументом", () => {
    const result = runCalcNoClock({ baseDir: join(fixtures, "violation") });
    expect(result.messages[0]).toBe(
      "packages/calc/src/clock.ts:2 — найдено «new Date()»: calc не читает часы, случайность и среду " +
        "(P1, ARCHITECTURE §2) — передайте дату или значение аргументом (сегодня — из Clock на сервере).",
    );
  });

  it("дата аргументом, Date.parse, Date.UTC, строки, комментарии, тесты и kernel — чисто", () => {
    const result = runCalcNoClock({ baseDir: join(fixtures, "clean") });
    expect({ code: result.code, files: result.files, findings: result.findings }).toEqual({
      code: 0,
      files: 2,
      findings: [],
    });
  });

  it("пакета calc ещё нет — код 0 и 0 файлов", () => {
    const empty = mkdtempSync(join(tmpdir(), "calc-no-clock-"));
    try {
      expect(runCalcNoClock({ baseDir: empty })).toMatchObject({ code: 0, files: 0 });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
