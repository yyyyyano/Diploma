// Генератор тестов изоляции (ROLE-01, SEC-04): по реестрам процедур и инструментов — случаи «A с id из B»;
// процедура или инструмент без фикстуры — проблема с подсказкой «добавьте фикстуру».
import { describe, expect, it } from "vitest";
import { contractProcedurePaths, generate, leakedIds, uncoveredUserTables } from "./isolation.ts";

/** Процедура контракта: как у @orpc/contract — объект с полем «~orpc». */
const procedure = { "~orpc": {} };
const contract = {
  system: { health: procedure },
  accounts: { list: procedure, get: procedure },
};
const procedures = {
  "system.health": "public",
  "accounts.list": "authed",
  "accounts.get": "authed",
} as const;

interface Seed {
  readonly accountId: string;
}

describe("ROLE-01: генератор тестов изоляции по реестрам", () => {
  it("пути процедур — из дерева контракта, по алфавиту", () => {
    expect(contractProcedurePaths(contract)).toEqual([
      "accounts.get",
      "accounts.list",
      "system.health",
    ]);
  });

  it("каждая процедура и инструмент с фикстурой — случай; исключение — с причиной", () => {
    const plan = generate<Seed>({
      contract,
      procedures,
      tools: ["list_accounts"],
      fixtures: {
        "system.health": { exempt: "публичная проба, данных не читает" },
        "accounts.list": { input: () => undefined },
        "accounts.get": { input: (b) => ({ id: b.accountId }) },
        "tool:list_accounts": { input: () => ({}) },
      },
    });
    expect(plan.problems).toEqual([]);
    expect(plan.cases.map((c) => [c.kind, c.name, c.access])).toEqual([
      ["procedure", "accounts.get", "authed"],
      ["procedure", "accounts.list", "authed"],
      ["tool", "list_accounts", "agent"],
    ]);
    expect(plan.cases[0]?.input({ accountId: "b-1" })).toEqual({ id: "b-1" });
    expect(plan.exempted).toEqual(["system.health — публичная проба, данных не читает"]);
  });

  it("новая процедура и новый инструмент без фикстуры — подсказка «добавьте фикстуру»", () => {
    const plan = generate<Seed>({
      contract,
      procedures,
      tools: ["get_account"],
      fixtures: {
        "system.health": { exempt: "публичная проба, данных не читает" },
        "accounts.list": { input: () => undefined },
      },
    });
    expect(plan.problems).toEqual([
      expect.stringMatching(/^«accounts\.get»: добавьте фикстуру изоляции/),
      expect.stringMatching(/^«tool:get_account»: добавьте фикстуру изоляции/),
    ]);
  });

  it("исключение без внятной причины, лишняя фикстура и процедура вне дерева сервера — проблемы", () => {
    const plan = generate<Seed>({
      contract,
      procedures: { "system.health": "public", "accounts.list": "authed" },
      tools: [],
      fixtures: {
        "system.health": { exempt: "так" },
        "accounts.list": { input: () => undefined },
        "accounts.delete": { input: () => undefined },
      },
    });
    expect(plan.problems).toEqual([
      "«accounts.get»: процедуры нет в дереве сервера — тест изоляции её не вызовет",
      "«system.health»: причина исключения — словами, не короче 10 символов",
      "«accounts.delete»: фикстура без процедуры или инструмента — уберите её",
    ]);
  });
});

describe("PRIV-05/06: полнота владельцев данных", () => {
  it("пользовательская таблица без defineUserData — названа", () => {
    const owners = new Map([["accounts", { tableNames: ["accounts"] }]]);
    expect(uncoveredUserTables(["accounts", "receipts", "chat_messages"], owners)).toEqual([
      "chat_messages",
      "receipts",
    ]);
    expect(uncoveredUserTables(["accounts"], owners)).toEqual([]);
  });
});

describe("утечка в ответе", () => {
  it("id B на любой глубине ответа найден; чужих нет — пусто", () => {
    const b = "0190f0a0-0000-7000-8000-00000000000b";
    expect(leakedIds({ items: [{ id: "a", nested: [b] }] }, [b])).toEqual([b]);
    expect(leakedIds({ items: [] }, [b])).toEqual([]);
    expect(leakedIds(undefined, [b])).toEqual([]);
  });
});
