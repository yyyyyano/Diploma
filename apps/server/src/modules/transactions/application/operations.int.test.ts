// TXN-01, TXN-03, TXN-05, STMT-02, STMT-09, AGT-05, AGT-07, P5 на Postgres: ручной ввод и правка сразу с «Отменить»
// (настоящий журнал actions), остаток счёта меняется вместе с операцией, удаление — только «Да», «Отменить» после
// него возвращает всё как было, операция в валюте при недоступном НБРБ сохраняется без суммы в BYN, счёт с операциями
// не удаляется.
import { AccountId, TransactionId } from "@kosht/contract";
import { LocalDate, Money } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  entry,
  newScope,
  transactionsWithJournal,
  WEB,
} from "./__fixtures__/transactions-with-journal.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const USD = { rateDate: "2026-10-28", rateE4: 29_871, scale: 1 };

/** Сценарий с «Наличными» домохозяйства: счёт заводит фасад, как при регистрации. */
async function withCash(options: Parameters<typeof transactionsWithJournal>[1] = {}) {
  const s = newScope(db);
  const t = transactionsWithJournal(db, options);
  const cash = await s.transaction((tx) => t.accounts.cash(tx));
  const balance = async (accountId: string = cash) => {
    const item = (await t.accounts.list(s)).items.find((i) => i.id === accountId);
    return item?.balance.minor;
  };
  return { s, t, cash, balance };
}

describe("TXN-01, TXN-03: ручной ввод", () => {
  it("расход 6,50 без счёта: «Наличные», вручную, личная, версия 1; остаток −6,50", async () => {
    const { s, t, cash, balance } = await withCash();
    const { transaction } = await t.ops.create(s, entry({ occurredTime: "08:47" }), WEB);
    expect(transaction).toMatchObject({
      accountId: cash,
      type: "expense",
      direction: "out",
      occurredOn: "2026-10-21",
      occurredTime: "08:47",
      amount: { minor: 650, currency: "BYN" },
      amountInByn: { minor: 650, currency: "BYN" },
      description: "Кофейня «Зерно»",
      merchantName: "Кофейня «Зерно»",
      category: { type: "system", code: "cafes" },
      categorySource: "user",
      source: "manual",
      visibility: "personal",
      version: 1,
    });
    expect(await balance()).toBe(-650);
  });

  it("одно событие transactions.changed с id и сигналы сайту по операции и по счёту", async () => {
    const { s, t, cash } = await withCash();
    const { transaction } = await t.ops.create(s, entry(), WEB);
    expect(t.published.filter((e) => e.name === "transactions.changed")).toEqual([
      { name: "transactions.changed", ids: [transaction.id] },
    ]);
    expect(t.signals).toContainEqual({ entity: "transaction", ids: [transaction.id] });
    expect(t.signals).toContainEqual({ entity: "account", ids: [cash] });
  });

  it("доход и возврат приводят деньги на счёт, перевод — со счёта по умолчанию или как выбрали", async () => {
    const { s, t, balance } = await withCash();
    const income = await t.ops.create(
      s,
      entry({
        type: "income",
        amount: Money.of(96_000, "BYN"),
        category: { type: "system", code: "salary" },
      }),
      WEB,
    );
    const refund = await t.ops.create(
      s,
      entry({ type: "refund", amount: Money.of(2490, "BYN") }),
      WEB,
    );
    const out = await t.ops.create(
      s,
      entry({ type: "transfer", amount: Money.of(10_000, "BYN"), category: null }),
      WEB,
    );
    const into = await t.ops.create(
      s,
      entry({ type: "transfer", direction: "in", amount: Money.of(500, "BYN"), category: null }),
      WEB,
    );
    expect([income, refund, out, into].map((r) => r.transaction.direction)).toEqual([
      "in",
      "in",
      "out",
      "in",
    ]);
    expect(out.transaction.category).toBeNull();
    expect(await balance()).toBe(96_000 + 2490 - 10_000 + 500);
  });

  it("сумма не больше нуля, чужая валюта, категория перевода и «не тот» вид категории — VALIDATION", async () => {
    const { s, t } = await withCash();
    const reject = (input: ReturnType<typeof entry>) =>
      expect(t.ops.create(s, input, WEB)).rejects.toMatchObject({ code: "VALIDATION" });
    await reject(entry({ amount: Money.of(0, "BYN") }));
    await reject(entry({ amount: Money.of(100, "USD") })); // «Наличные» — в BYN
    await reject(entry({ type: "transfer" })); // у перевода категории нет
    await reject(entry({ category: { type: "system", code: entryIncomeCode() } }));
    await reject(entry({ direction: "in" })); // расход не бывает «на счёт»
  });

  it("чужой счёт — NOT_FOUND, чужая своя категория — NOT_FOUND", async () => {
    const mine = await withCash();
    const other = await withCash();
    await expect(
      mine.t.ops.create(mine.s, entry({ accountId: AccountId.parse(other.cash) }), WEB),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const foreign = await other.t.categories.list(other.s);
    expect(foreign.items.length).toBeGreaterThan(0);
    await expect(
      mine.t.ops.create(
        mine.s,
        entry({
          category: { type: "custom", id: "0199c1a0-0000-7000-8000-0000000000aa" as never },
        }),
        WEB,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

function entryIncomeCode() {
  return "salary" as never;
}

describe("P5, TXN-03: «Отменить» после добавления", () => {
  it("«Отменить» убирает операцию и возвращает остаток; повтор — «уже отменено»", async () => {
    const { s, t, balance } = await withCash();
    const { transaction, undoToken } = await t.ops.create(s, entry(), WEB);
    expect(await balance()).toBe(-650);
    expect(await t.actions.undo(s, undoToken)).toBe("undone");
    expect(await balance()).toBe(0);
    expect((await t.ops.list(s, { page: 1, pageSize: 50 })).total).toBe(0);
    await expect(t.ops.get(s, transaction.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await t.actions.undo(s, undoToken)).toBe("already-undone");
  });
});

describe("TXN-03, STMT-02: правка", () => {
  it("6,50 → 8,00 сдвигает остаток на −1,50, версия 2; «Отменить» возвращает 6,50 и остаток", async () => {
    const { s, t, balance } = await withCash();
    const created = await t.ops.create(s, entry(), WEB);
    const edited = await t.ops.update(
      s,
      { id: created.transaction.id, expectedVersion: 1, patch: { amount: Money.of(800, "BYN") } },
      WEB,
    );
    expect(edited.transaction).toMatchObject({ amount: { minor: 800 }, version: 2 });
    expect(await balance()).toBe(-800);
    expect(await t.actions.undo(s, edited.undoToken)).toBe("undone");
    expect(await balance()).toBe(-650);
    expect((await t.ops.get(s, created.transaction.id)).transaction).toMatchObject({
      amount: { minor: 650 },
    });
  });

  it("версия, которую видел человек, устарела — CONFLICT, операция не тронута", async () => {
    const { s, t } = await withCash();
    const { transaction } = await t.ops.create(s, entry(), WEB);
    await t.ops.update(s, { id: transaction.id, patch: { note: "первая правка" } }, WEB);
    await expect(
      t.ops.update(s, { id: transaction.id, expectedVersion: 1, patch: { note: "вторая" } }, WEB),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await t.ops.get(s, transaction.id)).transaction.note).toBe("первая правка");
  });

  it("«Отменить» первой правки после второй — CONFLICT (позднюю правку не затираем)", async () => {
    const { s, t } = await withCash();
    const { transaction } = await t.ops.create(s, entry(), WEB);
    const first = await t.ops.update(s, { id: transaction.id, patch: { note: "раз" } }, WEB);
    await t.ops.update(s, { id: transaction.id, patch: { note: "два" } }, WEB);
    await expect(t.actions.undo(s, first.undoToken)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await t.ops.get(s, transaction.id)).transaction.note).toBe("два");
  });

  it("перенос на другой счёт: −сумма у прежнего, +сумма у нового; чужая валюта — VALIDATION", async () => {
    const { s, t, cash, balance } = await withCash({ rates: { USD } });
    const card = await t.accounts.create(
      s,
      {
        kind: "card",
        name: "Карта",
        bank: null,
        mask: null,
        currency: "BYN",
        initialBalance: null,
      },
      "web",
    );
    const usd = await t.accounts.create(
      s,
      { kind: "card", name: "USD", bank: null, mask: null, currency: "USD", initialBalance: null },
      "web",
    );
    const { transaction } = await t.ops.create(s, entry(), WEB);
    await t.ops.update(s, { id: transaction.id, patch: { accountId: card.account.id } }, WEB);
    expect(await balance(cash)).toBe(0);
    expect(await balance(card.account.id)).toBe(-650);
    await expect(
      t.ops.update(s, { id: transaction.id, patch: { accountId: usd.account.id } }, WEB),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("тип расход → доход без новой категории: «Кафе» не подходит доходу, категория подбирается заново", async () => {
    const { s, t } = await withCash();
    const { transaction } = await t.ops.create(s, entry(), WEB);
    const { transaction: income } = await t.ops.update(
      s,
      { id: transaction.id, patch: { type: "income" } },
      WEB,
    );
    expect(income).toMatchObject({ type: "income", direction: "in", categorySource: "fallback" });
    expect(income.category).toEqual({ type: "system", code: "other-income" });
  });

  it("правка без изменений — VALIDATION; чужая операция — NOT_FOUND", async () => {
    const mine = await withCash();
    const other = await withCash();
    const { transaction } = await mine.t.ops.create(mine.s, entry(), WEB);
    await expect(
      mine.t.ops.update(mine.s, { id: transaction.id, patch: { note: null } }, WEB),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      other.t.ops.update(other.s, { id: transaction.id, patch: { note: "чужая" } }, WEB),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("TXN-05: карточка и история изменений", () => {
  it("история: создана, затем правка суммы и комментария — с каналом и именами полей", async () => {
    const { s, t } = await withCash();
    const { transaction } = await t.ops.create(s, entry(), WEB);
    await t.ops.update(
      s,
      { id: transaction.id, patch: { amount: Money.of(700, "BYN"), note: "с сиропом" } },
      WEB,
    );
    const card = await t.ops.get(s, transaction.id);
    expect(
      card.history.map(({ action, channel, fields }) => ({ action, channel, fields })),
    ).toEqual([
      { action: "created", channel: "web", fields: [] },
      { action: "updated", channel: "web", fields: ["amount", "amountInByn", "note"] },
    ]);
    expect(card.rate).toBeNull();
  });
});

describe("AGT-07, P5, TXN-03: удаление — только после «Да», «Отменить» сразу после", () => {
  it("запрос удаления — решение с количеством и примером, операция на месте; «Да» удаляет и возвращает остаток", async () => {
    const { s, t, balance } = await withCash();
    const { transaction } = await t.ops.create(s, entry(), WEB);
    const decisionId = await t.ops.requestDelete(s, [transaction.id], "web");
    expect(await t.actions.decision(s, decisionId)).toMatchObject({
      status: "pending",
      summary: { key: "decisions.transactionsDelete", params: { count: 1 } },
    });
    expect(await balance()).toBe(-650);
    const answered = await t.actions.answer(s, decisionId, "yes", "web");
    expect(answered.status).toBe("yes");
    expect(answered.undoToken).not.toBeNull();
    expect(await balance()).toBe(0);
    await expect(t.ops.get(s, transaction.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("«Отменить» после «Да» воссоздаёт операцию с тем же id, версией выше и остатком как был", async () => {
    const { s, t, balance } = await withCash();
    const { transaction } = await t.ops.create(s, entry({ note: "утро" }), WEB);
    const decisionId = await t.ops.requestDelete(s, [transaction.id], "web");
    const { undoToken } = await t.actions.answer(s, decisionId, "yes", "web");
    expect(await t.actions.undo(s, undoToken ?? "")).toBe("undone");
    const back = await t.ops.get(s, transaction.id);
    expect(back.transaction).toMatchObject({ id: transaction.id, note: "утро", version: 2 });
    expect(await balance()).toBe(-650);
    expect(back.history.map((h) => h.action)).toEqual(["created", "deleted", "restored"]);
  });

  it("повторное «Да» ничего не делает; чужие id — NOT_FOUND ещё на вопросе", async () => {
    const mine = await withCash();
    const other = await withCash();
    const { transaction } = await mine.t.ops.create(mine.s, entry(), WEB);
    await expect(other.t.ops.requestDelete(other.s, [transaction.id], "web")).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    const decisionId = await mine.t.ops.requestDelete(mine.s, [transaction.id], "web");
    await mine.t.actions.answer(mine.s, decisionId, "yes", "web");
    expect(await mine.t.actions.answer(mine.s, decisionId, "yes", "web")).toEqual({
      status: "yes",
      undoToken: null,
    });
  });
});

describe("STMT-09: операция в валюте", () => {
  it("100 USD по курсу НБРБ: сумма в BYN и курс в карточке, «Откуда курс?» сохраняет расчёт с курсом", async () => {
    const { s, t } = await withCash({ rates: { USD } });
    const usd = await t.accounts.create(
      s,
      { kind: "card", name: "USD", bank: null, mask: null, currency: "USD", initialBalance: null },
      "web",
    );
    const { transaction } = await t.ops.create(
      s,
      entry({ accountId: usd.account.id, amount: Money.of(10_000, "USD") }),
      WEB,
    );
    expect(transaction.amount).toEqual({ minor: 10_000, currency: "USD" });
    // 100,00 USD × 2,9871 = 298,71 BYN
    expect(transaction.amountInByn).toEqual({ minor: 29_871, currency: "BYN" });
    const card = await t.ops.get(s, transaction.id);
    expect(card.rate).toEqual({ rateE4: 29_871, scale: 1, date: "2026-10-28" });
    const traceId = await t.ops.explainRate(s, transaction.id);
    const explanation = await t.explain.get(s, traceId);
    expect(JSON.stringify(explanation.trace)).toContain(
      `"refs":[{"id":"${t.rateId("USD")}","kind":"fxRate"}]`,
    );
  });

  it("НБРБ недоступен: операция сохранена без суммы в BYN, поставлена задача fill-rates; BYN и остаток целы", async () => {
    const { s, t } = await withCash({ rates: { USD } });
    const usd = await t.accounts.create(
      s,
      { kind: "card", name: "USD", bank: null, mask: null, currency: "USD", initialBalance: null },
      "web",
    );
    t.setRatesUp(false);
    const { transaction } = await t.ops.create(
      s,
      entry({ accountId: usd.account.id, amount: Money.of(10_000, "USD") }),
      WEB,
    );
    expect(transaction.amountInByn).toBeNull();
    expect(t.enqueued).toEqual([
      { name: "transactions.fill-rates", payload: { ids: [transaction.id] } },
    ]);
    expect((await t.accounts.list(s)).items.find((i) => i.id === usd.account.id)?.balance).toEqual(
      Money.of(-10_000, "USD"),
    );
    await expect(t.ops.explainRate(s, transaction.id)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  it("explainRate для операции в BYN — UNAVAILABLE (курса нет по смыслу)", async () => {
    const { s, t } = await withCash();
    const { transaction } = await t.ops.create(s, entry(), WEB);
    await expect(t.ops.explainRate(s, transaction.id)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });
});

describe("STMT-01: счёт с операциями удалить нельзя", () => {
  it("«Да» на удаление счёта с операциями — CONFLICT «account-has-transactions», счёт и операция на месте", async () => {
    const { s, t } = await withCash();
    const card = await t.accounts.create(
      s,
      {
        kind: "card",
        name: "Карта",
        bank: null,
        mask: null,
        currency: "BYN",
        initialBalance: null,
      },
      "web",
    );
    await t.ops.create(s, entry({ accountId: card.account.id }), WEB);
    const decisionId = await t.accounts.requestDelete(s, card.account.id);
    await expect(t.actions.answer(s, decisionId, "yes", "web")).rejects.toMatchObject({
      code: "CONFLICT",
      params: { reason: "account-has-transactions" },
    });
    expect((await t.accounts.list(s)).items.map((i) => i.id)).toContain(card.account.id);
    expect((await t.ops.list(s, { page: 1, pageSize: 50 })).total).toBe(1);
  });

  it("после удаления операции пустой счёт удаляется", async () => {
    const { s, t } = await withCash();
    const card = await t.accounts.create(
      s,
      {
        kind: "card",
        name: "Карта",
        bank: null,
        mask: null,
        currency: "BYN",
        initialBalance: null,
      },
      "web",
    );
    const { transaction } = await t.ops.create(s, entry({ accountId: card.account.id }), WEB);
    const del = await t.ops.requestDelete(s, [transaction.id], "web");
    await t.actions.answer(s, del, "yes", "web");
    const decisionId = await t.accounts.requestDelete(s, card.account.id);
    expect((await t.actions.answer(s, decisionId, "yes", "web")).status).toBe("yes");
    expect((await t.accounts.list(s)).items.map((i) => i.id)).not.toContain(card.account.id);
  });
});

describe("TXN-01: DTO без служебного", () => {
  it("в операции нет владельца, ключа контрагента и версии строки БД сверх контракта", async () => {
    const { s, t } = await withCash();
    const { transaction } = await t.ops.create(s, entry(), WEB);
    expect(Object.keys(transaction).sort()).toEqual(
      [
        "accountId",
        "amount",
        "amountInByn",
        "category",
        "categorySource",
        "description",
        "direction",
        "id",
        "merchantName",
        "note",
        "occurredOn",
        "occurredTime",
        "refundOfId",
        "source",
        "transferPairId",
        "type",
        "version",
        "visibility",
      ].sort(),
    );
    expect(TransactionId.safeParse(transaction.id).success).toBe(true);
    expect(LocalDate.parse("2026-10-21")).toBe(transaction.occurredOn);
  });
});
