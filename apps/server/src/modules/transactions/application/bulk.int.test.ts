// TXN-04, CAT-05, AGT-07, P5 на Postgres: массовые действия — вопрос с числом и примерами, до «Да» ничего не тронуто, «Да»
// исполняет код одной пачкой, одно «Отменить» возвращает всё как было (23 операции); ручная смена категории запоминает
// правило контрагента и спрашивает про прошлые («ТАКСИ 7788» дальше получает категорию без модели).
import { LocalDate, Money } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  entry,
  newScope,
  transactionsWithJournal,
  WEB,
} from "../../../main/__fixtures__/transactions-with-journal.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

async function setup() {
  const s = newScope(db);
  const t = transactionsWithJournal(db);
  const cash = await s.transaction((tx) => t.accounts.cash(tx));
  const balance = async () =>
    (await t.accounts.list(s)).items.find((item) => item.id === cash)?.balance.minor;
  return { s, t, cash, balance };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** N поездок на такси «ТАКСИ 7788» по 7,40: категорию подбирают правила (справочник и ключевые слова). */
async function taxiRides({ s, t }: Setup, count: number) {
  const rides = [];
  for (let i = 0; i < count; i += 1) {
    const day = String(1 + (i % 28)).padStart(2, "0");
    const { transaction } = await t.ops.create(
      s,
      entry({
        merchant: "ТАКСИ 7788",
        category: null,
        amount: Money.of(740, "BYN"),
        occurredOn: LocalDate.parse(`2026-10-${day}`),
      }),
      WEB,
    );
    rides.push(transaction);
  }
  return rides;
}

/** Элемент, который по сценарию точно есть (тест упал бы раньше). */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("ожидали значение");
  return value;
}

const TRANSPORT = { type: "system", code: "transport" } as const;
const lastEvent = (t: Setup["t"]) =>
  t.published.filter((e) => e.name === "transactions.changed").at(-1);

describe("TXN-04, AGT-07: сменить категорию 23 операциям — вопрос, «Да», «Отменить»", () => {
  it("вопрос с числом, категорией и примерами; до «Да» операции не тронуты", async () => {
    const env = await setup();
    const rides = await taxiRides(env, 23);
    const decisionId = await env.t.ops.requestChangeCategory(
      env.s,
      rides.map((r) => r.id),
      TRANSPORT,
      "web",
    );
    const decision = await env.t.actions.decision(env.s, decisionId);
    expect(decision).toMatchObject({
      status: "pending",
      summary: {
        key: "decisions.transactionsCategory",
        params: { count: 23, category: "Общественный транспорт" },
      },
    });
    expect(String(decision.summary.params["examples"]).split("; ")).toHaveLength(3);
    const after = await env.t.ops.list(env.s, { page: 1, pageSize: 100 });
    expect(
      after.items.every(
        (item) => item.category?.type === "system" && item.category.code !== "transport",
      ),
    ).toBe(true);
  });

  it("«Да» переносит все 23 одной пачкой — одно событие с 23 id; «Отменить» возвращает категории, источники и остаток", async () => {
    const env = await setup();
    const rides = await taxiRides(env, 23);
    const before = await env.t.ops.list(env.s, { page: 1, pageSize: 100 });
    const balanceBefore = await env.balance();
    const decisionId = await env.t.ops.requestChangeCategory(
      env.s,
      rides.map((r) => r.id),
      TRANSPORT,
      "web",
    );
    const { status, undoToken } = await env.t.actions.answer(env.s, decisionId, "yes", "web");
    expect(status).toBe("yes");
    expect(undoToken).not.toBeNull();
    const moved = await env.t.ops.list(env.s, { page: 1, pageSize: 100 });
    expect(moved.items).toHaveLength(23);
    expect(
      moved.items.every((i) => i.category?.type === "system" && i.category.code === "transport"),
    ).toBe(true);
    expect(moved.items.every((i) => i.categorySource === "user" && i.version === 2)).toBe(true);
    expect(lastEvent(env.t)?.ids).toHaveLength(23);
    expect(await env.balance()).toBe(balanceBefore);

    expect(await env.t.actions.undo(env.s, undoToken ?? "")).toBe("undone");
    const restored = await env.t.ops.list(env.s, { page: 1, pageSize: 100 });
    const key = (item: (typeof before.items)[number]) =>
      `${item.id}|${JSON.stringify(item.category)}|${item.categorySource ?? ""}`;
    expect(restored.items.map(key).sort()).toEqual(before.items.map(key).sort());
    expect(await env.balance()).toBe(balanceBefore);
  });

  it("«Нет» — ничего не меняется; категория не того вида (расходная для дохода) — VALIDATION; чужие id — NOT_FOUND", async () => {
    const env = await setup();
    const other = await setup();
    const [ride] = await taxiRides(env, 1);
    const income = await env.t.ops.create(
      env.s,
      entry({
        type: "income",
        amount: Money.of(100, "BYN"),
        category: { type: "system", code: "salary" },
      }),
      WEB,
    );
    const decisionId = await env.t.ops.requestChangeCategory(
      env.s,
      [must(ride).id],
      TRANSPORT,
      "web",
    );
    expect(await env.t.actions.answer(env.s, decisionId, "no", "web")).toEqual({
      status: "no",
      undoToken: null,
    });
    expect((await env.t.ops.get(env.s, must(ride).id)).transaction.category).not.toEqual(TRANSPORT);
    await expect(
      env.t.ops.requestChangeCategory(env.s, [income.transaction.id], TRANSPORT, "web"),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      other.t.ops.requestChangeCategory(other.s, [must(ride).id], TRANSPORT, "web"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("после пачки одну из операций правили — «Отменить» пачки CONFLICT и не трогает ни одной", async () => {
    const env = await setup();
    const rides = await taxiRides(env, 3);
    const decisionId = await env.t.ops.requestChangeCategory(
      env.s,
      rides.map((r) => r.id),
      TRANSPORT,
      "web",
    );
    const { undoToken } = await env.t.actions.answer(env.s, decisionId, "yes", "web");
    await env.t.ops.update(
      env.s,
      { id: must(rides[0]).id, patch: { note: "поздняя правка" } },
      WEB,
    );
    await expect(env.t.actions.undo(env.s, undoToken ?? "")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const now = await env.t.ops.list(env.s, { page: 1, pageSize: 50 });
    expect(
      now.items.every((i) => i.category?.type === "system" && i.category.code === "transport"),
    ).toBe(true);
  });
});

describe("TXN-04: пометить переводом и удалить пачкой", () => {
  it("«Пометить переводом»: тип «перевод», категории нет, направление и остаток прежние; «Отменить» возвращает расход с категорией", async () => {
    const env = await setup();
    const rides = await taxiRides(env, 3);
    const balanceBefore = await env.balance();
    const decisionId = await env.t.ops.requestMarkTransfer(
      env.s,
      rides.map((r) => r.id),
      "web",
    );
    expect(await env.t.actions.decision(env.s, decisionId)).toMatchObject({
      summary: { key: "decisions.transactionsTransfer", params: { count: 3 } },
    });
    const { undoToken } = await env.t.actions.answer(env.s, decisionId, "yes", "web");
    const marked = await env.t.ops.list(env.s, { page: 1, pageSize: 50 });
    expect(
      marked.items.every(
        (i) => i.type === "transfer" && i.category === null && i.direction === "out",
      ),
    ).toBe(true);
    expect(await env.balance()).toBe(balanceBefore);
    await env.t.actions.undo(env.s, undoToken ?? "");
    const back = await env.t.ops.list(env.s, { page: 1, pageSize: 50 });
    expect(back.items.every((i) => i.type === "expense" && i.category !== null)).toBe(true);
    expect(await env.balance()).toBe(balanceBefore);
  });

  it("удалить 23: «Да» удаляет все и возвращает остаток, «Отменить» воссоздаёт все с теми же id", async () => {
    const env = await setup();
    const rides = await taxiRides(env, 23);
    const ids = rides.map((r) => r.id).sort();
    const balanceBefore = await env.balance();
    const decisionId = await env.t.ops.requestDelete(env.s, ids, "web");
    expect(await env.t.actions.decision(env.s, decisionId)).toMatchObject({
      summary: { params: { count: 23 } },
    });
    const { undoToken } = await env.t.actions.answer(env.s, decisionId, "yes", "web");
    expect((await env.t.ops.list(env.s, { page: 1, pageSize: 50 })).total).toBe(0);
    expect(await env.balance()).toBe(0);
    await env.t.actions.undo(env.s, undoToken ?? "");
    const back = await env.t.ops.list(env.s, { page: 1, pageSize: 50 });
    expect(back.items.map((i) => i.id).sort()).toEqual(ids);
    expect(await env.balance()).toBe(balanceBefore);
  });
});

describe("CAT-05: ручная смена категории — правило контрагента и «Применить к N прошлым?»", () => {
  it("правка категории создаёт правило и спрашивает про N прошлых; «Да» меняет их с «Отменить», выбранные вручную не трогает", async () => {
    const env = await setup();
    const rides = await taxiRides(env, 4);
    const manual = await env.t.ops.create(
      env.s,
      entry({ merchant: "ТАКСИ 7788", category: { type: "system", code: "leisure" } }),
      WEB,
    );
    const first = rides[0];
    const { applyToPast } = await env.t.ops.update(
      env.s,
      { id: must(first).id, patch: { category: TRANSPORT } },
      WEB,
    );
    expect(applyToPast).toMatchObject({ count: 3 });
    expect(await env.t.actions.decision(env.s, applyToPast?.decisionId ?? "")).toMatchObject({
      summary: {
        key: "decisions.transactionsApplyRule",
        params: { count: 3, category: "Общественный транспорт" },
      },
    });
    const answered = await env.t.actions.answer(env.s, applyToPast?.decisionId ?? "", "yes", "web");
    const after = await env.t.ops.list(env.s, { page: 1, pageSize: 50 });
    const byId = new Map(after.items.map((i) => [i.id, i]));
    for (const ride of rides.slice(1)) {
      expect(byId.get(ride.id)).toMatchObject({ category: TRANSPORT, categorySource: "user-rule" });
    }
    expect(byId.get(manual.transaction.id)?.category).toEqual({ type: "system", code: "leisure" });
    await env.t.actions.undo(env.s, answered.undoToken ?? "");
    const undone = await env.t.ops.get(env.s, must(rides[1]).id);
    expect(undone.transaction.category).not.toEqual(TRANSPORT);
  });

  it("КП CAT: следующая «ТАКСИ 7788» сразу получает «Общественный транспорт» по правилу — без вызова модели", async () => {
    const env = await setup();
    const [ride] = await taxiRides(env, 1);
    await env.t.ops.update(env.s, { id: must(ride).id, patch: { category: TRANSPORT } }, WEB);
    const next = await env.t.ops.create(
      env.s,
      entry({ merchant: "ТАКСИ 7788", category: null }),
      WEB,
    );
    expect(next.transaction).toMatchObject({ category: TRANSPORT, categorySource: "user-rule" });
    expect(env.t.modelCalls).toEqual([]);
    expect(env.t.enqueued.filter((job) => job.name === "transactions.categorize")).toEqual([]);
  });

  it("«Отменить» исправления снимает правило: следующая «ТАКСИ 7788» снова по справочнику, и «Применить» ничего не оставляет", async () => {
    const env = await setup();
    const [ride] = await taxiRides(env, 1);
    const before = ride?.category;
    const { undoToken } = await env.t.ops.update(
      env.s,
      { id: must(ride).id, patch: { category: TRANSPORT } },
      WEB,
    );
    await env.t.actions.undo(env.s, undoToken);
    const next = await env.t.ops.create(
      env.s,
      entry({ merchant: "ТАКСИ 7788", category: null }),
      WEB,
    );
    expect(next.transaction.category).toEqual(before);
    expect(next.transaction.categorySource).not.toBe("user-rule");
  });

  it("прежнее правило возвращается: исправили на «Транспорт», затем на «Развлечения», «Отменить» — снова «Транспорт»", async () => {
    const env = await setup();
    const [ride] = await taxiRides(env, 1);
    await env.t.ops.update(env.s, { id: must(ride).id, patch: { category: TRANSPORT } }, WEB);
    const second = await env.t.ops.update(
      env.s,
      { id: must(ride).id, patch: { category: { type: "system", code: "leisure" } } },
      WEB,
    );
    await env.t.actions.undo(env.s, second.undoToken);
    const next = await env.t.ops.create(
      env.s,
      entry({ merchant: "ТАКСИ 7788", category: null }),
      WEB,
    );
    expect(next.transaction.category).toEqual(TRANSPORT);
  });

  it("операция без контрагента — правила нет и вопроса нет; прошлых нет — вопроса нет; тот же выбор — вопроса нет", async () => {
    const env = await setup();
    const bare = await env.t.ops.create(env.s, entry({ merchant: null }), WEB);
    const changed = await env.t.ops.update(
      env.s,
      { id: bare.transaction.id, patch: { category: TRANSPORT } },
      WEB,
    );
    expect(changed.applyToPast).toBeNull();
    const [only] = await taxiRides(env, 1);
    const alone = await env.t.ops.update(
      env.s,
      { id: must(only).id, patch: { category: TRANSPORT } },
      WEB,
    );
    expect(alone.applyToPast).toBeNull();
    const same = await env.t.ops.update(
      env.s,
      { id: must(only).id, patch: { category: TRANSPORT, note: "тот же выбор" } },
      WEB,
    );
    expect(same.applyToPast).toBeNull();
  });

  it("«Нет» на вопрос про прошлые — прошлые не тронуты, правило осталось", async () => {
    const env = await setup();
    const rides = await taxiRides(env, 3);
    const { applyToPast } = await env.t.ops.update(
      env.s,
      { id: must(rides[0]).id, patch: { category: TRANSPORT } },
      WEB,
    );
    await env.t.actions.answer(env.s, applyToPast?.decisionId ?? "", "no", "web");
    expect((await env.t.ops.get(env.s, must(rides[1]).id)).transaction.category).not.toEqual(
      TRANSPORT,
    );
    const next = await env.t.ops.create(
      env.s,
      entry({ merchant: "ТАКСИ 7788", category: null }),
      WEB,
    );
    expect(next.transaction.category).toEqual(TRANSPORT);
  });
});
