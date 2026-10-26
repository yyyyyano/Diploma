// P5, AGT-05, AGT-07 на Postgres: «Отменить» вызывает обработчик модуля-владельца в одной транзакции с отметкой,
// повторная отмена и повторный ответ ничего не меняют, чужой токен или решение — NOT_FOUND, отмена после более
// поздней правки того же объекта — CONFLICT (обработчик не вызван, данные не тронуты).
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb, type ScopedDb } from "../../../platform/db/scoped-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { ActionHandler } from "../../../platform/module/define-module.ts";
import { insertDecision } from "../infrastructure/db/actions.repo.ts";
import { makeDecisions } from "./decisions.ts";
import { makeJournal } from "./journal.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const clock = new FakeClock("2026-10-26T09:00:00Z");

function setup(
  handlers: { undo?: Record<string, ActionHandler>; confirm?: Record<string, ActionHandler> } = {},
) {
  const calls: { handler: string; household: string; payload: unknown }[] = [];
  const track =
    (name: string): ActionHandler =>
    async (s, payload) => {
      calls.push({ handler: name, household: s.scope.householdId, payload });
    };
  const platform = {
    clock,
    log: memoryLogger().log,
    actionHandlers: () => ({
      undo: new Map(Object.entries({ "test.add": track("test.add"), ...handlers.undo })),
      confirm: new Map(
        Object.entries({ "test.delete": track("test.delete"), ...handlers.confirm }),
      ),
    }),
  };
  return { journal: makeJournal(platform), decisions: makeDecisions(platform), calls };
}

function scoped(n: number): ScopedDb {
  return createScopedDb(db.pool, testScope({ user: n, household: n }));
}

async function journalRow(s: ScopedDb, id: string) {
  const { rows } = await db.owner.query<{
    status: string;
    channel: string;
    undone_at: Date | null;
  }>("select status, channel, undone_at from action_journal where household_id = $1 and id = $2", [
    s.scope.householdId,
    id,
  ]);
  return rows[0];
}

describe("P5, AGT-05: отмена действия", () => {
  it("«Отменить» вызывает обработчик владельца с нагрузкой и отмечает действие; повтор — без эффекта", async () => {
    const s = scoped(1);
    const { journal, calls } = setup();
    const token = await s.transaction((tx) =>
      journal.record(tx, {
        handler: "test.add",
        payload: { ids: ["t-1"] },
        subject: "transaction:t-1",
        channel: "web",
      }),
    );
    expect(await journal.undo(s, token)).toBe("undone");
    expect(await journal.undo(s, token)).toBe("already-undone");
    expect(calls).toEqual([
      { handler: "test.add", household: s.scope.householdId, payload: { ids: ["t-1"] } },
    ]);
    expect(await journalRow(s, token)).toMatchObject({ status: "undone", channel: "web" });
  });

  it("две отмены одновременно — обработчик вызван один раз", async () => {
    const s = scoped(2);
    const { journal, calls } = setup();
    const token = await journal.record(s, {
      handler: "test.add",
      payload: {},
      subject: "transaction:t-2",
      channel: "telegram",
    });
    const results = await Promise.all([journal.undo(s, token), journal.undo(s, token)]);
    expect(results.toSorted()).toEqual(["already-undone", "undone"]);
    expect(calls).toHaveLength(1);
  });

  it("чужой и неизвестный токен — NOT_FOUND, обработчик не вызван", async () => {
    const owner = scoped(3);
    const { journal, calls } = setup();
    const token = await journal.record(owner, {
      handler: "test.add",
      payload: {},
      subject: "transaction:t-3",
      channel: "web",
    });
    await expect(journal.undo(scoped(4), token)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(journal.undo(owner, "0199f0a0-0000-7000-8000-0000000000aa")).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
    expect(calls).toEqual([]);
    expect(await journalRow(owner, token)).toMatchObject({ status: "done" });
  });

  it("объект правили после действия — CONFLICT, обработчик не вызван; после отмены правки — отмена проходит", async () => {
    const s = scoped(5);
    const { journal, calls } = setup();
    const first = await journal.record(s, {
      handler: "test.add",
      payload: { v: 1 },
      subject: "transaction:t-5",
      channel: "web",
    });
    clock.advance(1_000);
    const later = await journal.record(s, {
      handler: "test.add",
      payload: { v: 2 },
      subject: "transaction:t-5",
      channel: "web",
    });
    await expect(journal.undo(s, first)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(calls).toEqual([]);
    expect(await journalRow(s, first)).toMatchObject({ status: "done" });

    await journal.undo(s, later);
    expect(await journal.undo(s, first)).toBe("undone");
    expect(calls.map((c) => c.payload)).toEqual([{ v: 2 }, { v: 1 }]);
  });

  it("сбой обработчика — отмена откатывается, действие остаётся «сделано»", async () => {
    const s = scoped(6);
    const { journal } = setup({
      undo: {
        "test.add": async (tx) => {
          await insertDecision(
            tx,
            { handler: "test.delete", payload: {}, summary: { key: "x", params: {} } },
            clock.now(),
          );
          throw new Error("сбой владельца");
        },
      },
    });
    const token = await journal.record(s, {
      handler: "test.add",
      payload: {},
      subject: "transaction:t-6",
      channel: "web",
    });
    await expect(journal.undo(s, token)).rejects.toThrow("сбой владельца");
    expect(await journalRow(s, token)).toMatchObject({ status: "done", undone_at: null });
    const { rows } = await db.owner.query(
      "select 1 from pending_decisions where household_id = $1",
      [s.scope.householdId],
    );
    expect(rows).toEqual([]);
  });

  it("неизвестный обработчик при записи — ошибка программы", async () => {
    const { journal } = setup();
    await expect(
      journal.record(scoped(7), {
        handler: "test.unknown",
        payload: {},
        subject: "x:1",
        channel: "web",
      }),
    ).rejects.toThrow(/Нет обработчика отмены test.unknown/);
  });
});

describe("AGT-07, NOTIF-05: ожидающие решения «Да/Нет»", () => {
  const summary = { key: "decisions.test", params: { count: 23 } };

  it("«Да» исполняет обработчик владельца один раз; повторный ответ возвращает прежний итог", async () => {
    const s = scoped(8);
    const { decisions, calls } = setup();
    const id = await decisions.propose(s, {
      handler: "test.delete",
      payload: { ids: ["a"] },
      summary,
    });
    expect(await decisions.get(s, id)).toMatchObject({ status: "pending", summary });
    expect(await decisions.answer(s, id, "yes", "telegram")).toBe("yes");
    expect(await decisions.answer(s, id, "no", "web")).toBe("yes");
    expect(calls).toEqual([
      { handler: "test.delete", household: s.scope.householdId, payload: { ids: ["a"] } },
    ]);
    const { rows } = await db.owner.query<{ channel: string }>(
      "select channel from pending_decisions where id = $1",
      [id],
    );
    expect(rows[0]?.channel).toBe("telegram");
  });

  it("«Нет» — без обработчика; чужое решение — NOT_FOUND", async () => {
    const s = scoped(9);
    const { decisions, calls } = setup();
    const id = await decisions.propose(s, { handler: "test.delete", payload: {}, summary });
    await expect(decisions.answer(scoped(10), id, "yes", "web")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(decisions.get(scoped(10), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await decisions.answer(s, id, "no", "web")).toBe("no");
    expect(calls).toEqual([]);
  });

  it("два «Да» одновременно — обработчик один раз", async () => {
    const s = scoped(11);
    const { decisions, calls } = setup();
    const id = await decisions.propose(s, { handler: "test.delete", payload: {}, summary });
    await Promise.all([
      decisions.answer(s, id, "yes", "web"),
      decisions.answer(s, id, "yes", "telegram"),
    ]);
    expect(calls).toHaveLength(1);
  });

  it("неизвестный обработчик при создании — ошибка программы", async () => {
    const { decisions } = setup();
    await expect(
      decisions.propose(scoped(12), { handler: "test.unknown", payload: {}, summary }),
    ).rejects.toThrow(/Нет обработчика подтверждения/);
  });
});
