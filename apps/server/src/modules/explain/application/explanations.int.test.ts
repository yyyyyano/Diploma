// EXPL-01, EXPL-02 на Postgres: сохранённый расчёт отдаётся ровно таким, каким сохранён, — даже если исходные данные
// потом изменились и тот же показатель сегодня считается иначе; чужой traceId — NOT_FOUND; инструмент explain_number
// отдаёт ту же трассу.
import { freeBalance, node } from "@kosht/calc";
import { LocalDate, Money, Period } from "@kosht/kernel";
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import { explainNumberTool } from "../agent/tools.ts";
import { makeExplanations } from "./explanations.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const byn = (key: string, minor: number) => node(key, Money.of(minor, "BYN"));
const september = Period.of(LocalDate.parse("2026-07-01"), LocalDate.parse("2026-09-30"));

describe("EXPL-02: объяснение — тот самый расчёт", () => {
  it("исходные данные изменились — get отдаёт прежнюю трассу 2 400 − 180 − 35 − 1 200 − 145 = 840 и период", async () => {
    const s = createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
    const explanations = makeExplanations({ clock: new FakeClock("2026-10-21T09:00:00Z") });
    const obligations = [
      byn("fin.obligation.utilities", 18_000),
      byn("fin.obligation.communication", 3_500),
      byn("fin.obligation.loan", 120_000),
      byn("fin.obligation.subscriptions", 14_500),
    ];
    const then = freeBalance({
      averageIncome: byn("fin.averageIncome", 240_000),
      averageObligations: obligations,
    });
    const traceId = await explanations.save(s, then, { period: september });

    // ЖКХ подорожало — сегодняшний расчёт другой, а объяснение сохранённого числа прежнее.
    const now = freeBalance({
      averageIncome: byn("fin.averageIncome", 240_000),
      averageObligations: [byn("fin.obligation.utilities", 25_000), ...obligations.slice(1)],
    });
    expect(now.value).not.toEqual(then.value);

    const saved = await explanations.get(s, traceId);
    expect(saved.trace).toEqual(then.trace);
    expect(saved.trace.value).toEqual(Money.of(84_000, "BYN"));
    expect(saved.period).toEqual(september);
    expect(saved.createdAt).toEqual(new Date("2026-10-21T09:00:00Z"));
  });

  it("чужой traceId — NOT_FOUND; без периода — period undefined", async () => {
    const owner = createScopedDb(db.pool, testScope({ user: 2, household: 2 }));
    const explanations = makeExplanations({ clock: new FakeClock("2026-10-21T09:00:00Z") });
    const traceId = await explanations.save(owner, byn("fin.averageIncome", 100));
    expect((await explanations.get(owner, traceId)).period).toBeUndefined();
    const stranger = createScopedDb(db.pool, testScope({ user: 3, household: 3 }));
    await expect(explanations.get(stranger, traceId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("инструмент explain_number: сохранённая трасса по traceId, данные — только ctx.s", async () => {
    const s = createScopedDb(db.pool, testScope({ user: 4, household: 4 }));
    const explanations = makeExplanations({ clock: new FakeClock("2026-10-21T09:00:00Z") });
    const calc = byn("fin.averageIncome", 240_000);
    const traceId = await explanations.save(s, calc);
    const tool = explainNumberTool(explanations);
    const result = await tool.execute({ s, requestId: "req-1", channel: "web" }, { traceId });
    expect(tool.output.parse(result)).toEqual({
      id: traceId,
      trace: calc.trace,
      period: null,
      createdAt: "2026-10-21T09:00:00.000Z",
    });
  });
});
