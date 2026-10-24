// Замок 4 изоляции (ROLE-01, SEC-04, ARCHITECTURE §6.2, §6.4): isolation.mjs на фикстурах с настоящей
// раскладкой путей. Нарушение каждого вида называет файл и строку; чистая фикстура с похожим, но законным кодом
// (ToolDef.execute, makeScope на входах и в адаптере инструментов, SQL в репозитории, sweep с householdId)
// проходит. Соседи исключений лежат в нарушениях: расширенное исключение проверка заметит.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runIsolation } from "./isolation.mjs";

const fixtures = fileURLToPath(
  new URL("../architecture/fixtures/checks/isolation/", import.meta.url),
);
const receipts = "apps/server/src/modules/receipts";

function found(baseDir: string): string[] {
  return runIsolation({ baseDir }).findings.map((f) => `${f.file}:${f.line} ${f.rule}`);
}

describe("isolation: нарушения на фикстуре", () => {
  const violations = found(join(fixtures, "violation"));

  it("makeScope и подделка Scope (as Scope, <Scope>) вне входов", () => {
    expect(violations).toEqual(
      expect.arrayContaining([
        `${receipts}/application/forge-scope.ts:1 scope-outside-entry`,
        `${receipts}/application/forge-scope.ts:4 scope-outside-entry`,
        `${receipts}/application/forge-scope.ts:5 scope-outside-entry`,
        `${receipts}/application/forge-scope.ts:6 scope-outside-entry`,
      ]),
    );
  });

  it("s.db.execute и sql.raw вне infrastructure/db", () => {
    expect(violations).toEqual(
      expect.arrayContaining([
        `${receipts}/application/raw-sql.ts:4 raw-sql-outside-db`,
        `${receipts}/application/raw-sql.ts:5 raw-sql-outside-db`,
      ]),
    );
  });

  it("$client и unsafeRaw мимо ScopedDb", () => {
    expect(violations).toEqual(
      expect.arrayContaining([
        `${receipts}/application/bypass.ts:1 db-client-bypass`,
        `${receipts}/application/bypass.ts:4 db-client-bypass`,
        `${receipts}/application/bypass.ts:5 db-client-bypass`,
      ]),
    );
  });

  it("db.query.* запрещён даже в репозитории", () => {
    expect(violations).toContain(
      `${receipts}/infrastructure/db/receipts.repo.ts:2 relational-query`,
    );
  });

  it("householdId, «userId» в кавычках и ownerId во входе процедуры, инструмента, задачи и события", () => {
    expect(violations).toEqual(
      expect.arrayContaining([
        "packages/contract/src/receipts.ts:5 owner-in-input",
        "packages/contract/src/receipts.ts:6 owner-in-input",
        `${receipts}/agent/tools.ts:4 owner-in-input`,
        `${receipts}/jobs/recognize.job.ts:3 owner-in-input`,
        `${receipts}/events.ts:1 owner-in-input`,
      ]),
    );
  });

  it("исключения не шире своих папок: соседи входов, platform/db и infrastructure/db проверяются", () => {
    expect(violations).toEqual(
      expect.arrayContaining([
        "apps/server/src/platform/realtime/channel.ts:1 scope-outside-entry",
        "apps/server/src/modules/telegram/application/link.ts:1 scope-outside-entry",
        "packages/contract/src/scope.ts:1 scope-outside-entry",
        "apps/server/src/platform/http/raw.ts:1 db-client-bypass",
        "apps/server/src/platform/http/raw.ts:4 db-client-bypass",
        "apps/server/src/platform/http/raw.ts:5 raw-sql-outside-db",
        "apps/server/src/platform/http/raw.ts:6 db-client-bypass",
        `${receipts}/infrastructure/ocr-client.ts:1 raw-sql-outside-db`,
      ]),
    );
  });

  it("ничего лишнего: ровно 26 нарушений, код 1, сообщение «файл:строка — что исправить»", () => {
    const result = runIsolation({ baseDir: join(fixtures, "violation") });
    expect({ code: result.code, count: violations.length }).toEqual({ code: 1, count: 26 });
    expect(result.messages).toContain(
      `${receipts}/application/forge-scope.ts:5 — ` +
        "Scope собирается только на входах (ARCHITECTURE §6.4), найдено «as Scope»: " +
        "примите s: ScopedDb первым аргументом и берите s.scope.",
    );
  });
});

describe("isolation: законный код не ловится", () => {
  it("чистая фикстура — код 0; тесты не проверяются, остальные 12 файлов — да", () => {
    const result = runIsolation({ baseDir: join(fixtures, "clean") });
    expect({ code: result.code, files: result.files, findings: result.findings }).toEqual({
      code: 0,
      files: 12,
      findings: [],
    });
  });

  it("корней apps/server/src и packages нет — код 0 и 0 файлов, а не ошибка", () => {
    const empty = mkdtempSync(join(tmpdir(), "isolation-"));
    try {
      expect(runIsolation({ baseDir: empty })).toMatchObject({ code: 0, files: 0 });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("корень есть, а в нём только тесты — код 2: проверять нечего, это подозрительно", () => {
    const base = mkdtempSync(join(tmpdir(), "isolation-"));
    try {
      mkdirSync(join(base, "packages/kernel"), { recursive: true });
      writeFileSync(join(base, "packages/kernel/scope.test.ts"), "makeScope();\n");
      expect(runIsolation({ baseDir: base }).code).toBe(2);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
