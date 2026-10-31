// AGT-03 «калькулятор», AGT-04, EXPL-02: арифметика и даты через calc, каждый ответ — с traceId сохранённого расчёта;
// «умножить на 12», «урезать на треть», доля, дата + N дней, дней между датами; неверный вызов — VALIDATION.
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb, type ScopedDb } from "../../../platform/db/scoped-db.ts";
import { makeExplanations } from "../application/explanations.ts";
import { calculatorTool } from "./calculator.ts";

let db: TestDb;
let s: ScopedDb;
const explanations = () => makeExplanations({ clock: new FakeClock("2026-10-31T09:00:00Z") });
const tool = () => calculatorTool(explanations());
const ctx = () => ({ s, requestId: "req-1", channel: "web" as const });
const call = (input: Record<string, unknown>) => {
  const t = tool();
  return t.execute(ctx(), t.input.parse(input));
};

beforeAll(async () => {
  db = await createTestDb();
  s = createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
});
afterAll(async () => {
  await db.drop();
});

describe("AGT-03: calculator", () => {
  it("кафе за лето 1 000,00 BYN, урезать на треть — 333,33 BYN, и трасса сохранена", async () => {
    const result = await call({ op: "scale", a: 100_000, b: 1, c: 3 });
    expect(result).toMatchObject({ kind: "money", minor: 33_333, currency: "BYN" });
    expect(result.text).toBe("333,33 BYN");
    const saved = await explanations().get(s, (result as { traceId: string }).traceId);
    expect(saved.trace.value).toEqual({ minor: 33_333, currency: "BYN" });
  });

  it("умножить на 12 без знаменателя — c по умолчанию 1", async () => {
    expect(await call({ op: "scale", a: 1_525, b: 12 })).toMatchObject({
      kind: "money",
      minor: 18_300,
    });
  });

  it("сумма и разность в копейках", async () => {
    expect(await call({ op: "sum", values: [1_000, 250, 5] })).toMatchObject({ minor: 1_255 });
    expect(await call({ op: "sub", a: 1_000, b: 1_250 })).toMatchObject({ minor: -250 });
  });

  it("доля: 234,56 из 1 000,00 — «23 %»", async () => {
    expect(await call({ op: "percent", a: 23_456, b: 100_000 })).toMatchObject({
      kind: "percent",
      value: 23,
      text: "23 %",
    });
  });

  it("дата + 30 дней и дней между датами; трасса хранит число дней", async () => {
    const shifted = await call({ op: "add_days", date: "2026-10-15", days: 30 });
    expect(shifted).toMatchObject({ kind: "date", date: "2026-11-14", text: "14.11.2026" });
    const between = await call({ op: "days_between", date: "2026-09-01", date2: "2026-10-31" });
    expect(between).toMatchObject({ kind: "days", value: 60 });
    const saved = await explanations().get(s, (between as { traceId: string }).traceId);
    expect(saved.trace.value).toBe(60);
  });

  it("тот же расчёт — тот же traceId (таблица не растёт)", async () => {
    const first = await call({ op: "sum", values: [7, 8] });
    const again = await call({ op: "sum", values: [7, 8] });
    expect((again as { traceId: string }).traceId).toBe((first as { traceId: string }).traceId);
  });

  it.each([
    ["деление на ноль", { op: "scale", a: 100, b: 1, c: 0 }],
    ["дробные копейки", { op: "sum", values: [10.5] }],
    ["пустая сумма", { op: "sum", values: [] }],
    ["несуществующая дата", { op: "add_days", date: "2026-02-31", days: 1 }],
    ["нет аргумента", { op: "sub", a: 1 }],
    ["целое не больше нуля", { op: "percent", a: 1, b: 0 }],
    ["неверная валюта", { op: "sum", values: [1], currency: "бел" }],
  ])("%s — VALIDATION, а не сбой программы", async (_name, input) => {
    await expect(call(input)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("описание — по-английски, во входе нет владельца, вид — read", () => {
    const t = tool();
    expect(t.kind).toBe("read");
    expect(Object.keys(t.input.shape)).not.toContain("userId");
  });
});
