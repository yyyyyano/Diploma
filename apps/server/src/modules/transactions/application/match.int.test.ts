// TXN-10, TXN-11, RCPT-10, NOTIF-02, NOTIF-05, STMT-07 на Postgres: чек и платёж по карте — одна операция, а не две. Единственный
// уверенный кандидат связывается сам с уведомлением и «Отменить»; несколько или неуверенно — один вопрос «одна покупка?»;
// ручная связь и разрыв из карточки; «Это разные покупки» возвращает чек к операции «без пары» и пару больше не предлагает.
// Чек до выписки сначала наличная трата, после импорта привязан, наличная исчезает.
import { node, sum } from "@kosht/calc";
import { LocalDate, Money } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  newScope,
  transactionsWithJournal,
} from "../../../main/__fixtures__/transactions-with-journal.ts";
import { listSplits } from "../infrastructure/db/transactions.repo.ts";
import type { ImportRow } from "./import-batch.ts";
import type { ReceiptOperation } from "./receipt-ops.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const byn = (minor: number) => Money.of(minor, "BYN");

async function setup() {
  const s = newScope(db);
  const t = transactionsWithJournal(db);
  const card = await s.transaction((tx) =>
    t.accounts.findOrCreate(tx, { bank: "Лесбанк", mask: "4821", currency: "BYN" }),
  );
  const cash = await s.transaction((tx) => t.accounts.cash(tx));
  const balance = async (id: string) =>
    (await t.accounts.list(s)).items.find((item) => item.id === id)?.balance.minor;
  /** Операция выписки: расход по карте, как её записывает импорт. */
  const bank = async (over: Partial<ImportRow> = {}) => {
    const key = randomUUID();
    const result = await s.transaction((tx) =>
      t.imports.importBatch(tx, {
        importId: randomUUID(),
        rows: [
          {
            accountId: card,
            type: "expense",
            direction: "out",
            occurredOn: "2026-10-13",
            amount: byn(4730),
            amountBynMinor: 4730,
            fxRateId: null,
            description: "EVROOPT MINSK",
            merchantName: "Евроопт",
            merchantKey: "EVROOPT",
            category: { code: "groceries", source: "merchant" },
            dedupeKey: key,
            ...over,
          },
        ],
      }),
    );
    return result.ids[0] ?? "";
  };
  /** Операция от чека (как её пишет receipts): наличные или карта, 47,30 от 12.10 «Евроопт». */
  const receipt = async (over: Partial<ReceiptOperation> = {}) => {
    const input: ReceiptOperation = {
      receiptId: randomUUID(),
      method: "cash",
      cardLast4: null,
      occurredOn: "2026-10-12",
      occurredTime: "14:37:22",
      amount: byn(4730),
      merchantName: "Евроопт",
      merchantKey: "EVROOPT",
      category: { code: "groceries", source: "keyword" },
      splits: [
        { category: { code: "groceries" }, amount: byn(4000) },
        { category: { code: "other" }, amount: byn(730) },
      ],
      needsReview: false,
      ...over,
    };
    const { id } = await s.transaction((tx) => t.ops.recordFromReceipt(tx, input));
    return { ...input, txId: id };
  };
  /** Расходы месяца — суммой через calc (фасад агрегатов — T-031). */
  const monthExpenses = async () => {
    const list = await t.ops.list(s, {
      from: LocalDate.parse("2026-10-01"),
      to: LocalDate.parse("2026-10-31"),
      type: "expense",
      page: 1,
      pageSize: 100,
    });
    const [first, ...rest] = list.items.map((item) => node("transactions.amount", item.amount));
    return first === undefined ? 0 : sum("fin.total", [first, ...rest]).value.minor;
  };
  const get = async (id: string) => (await t.ops.get(s, id)).transaction;
  return { s, t, card, cash, balance, bank, receipt, monthExpenses, get };
}

describe("КП TXN: чек 47,30 от 12.10 и платёж 47,30 от 13.10 «EVROOPT» — одна операция", () => {
  it("чек загружен позже выписки: единственный уверенный платёж связывается сам, расходы месяца +47,30, а не +94,60", async () => {
    const { s, t, bank, receipt, monthExpenses, get } = await setup();
    const bankId = await bank();
    const r = await receipt({ method: "card" });
    expect(await monthExpenses()).toBe(9460);
    expect(await t.ops.matchReceipt(s, r.receiptId)).toBe("linked");
    expect(await monthExpenses()).toBe(4730);
    expect(await t.ops.operationOfReceipt(s, r.receiptId)).toMatchObject({
      id: bankId,
      source: "statement",
    });
    // Сумма и день — из выписки, разбивка — из чека, ссылка на чек у операции банка.
    expect(await get(bankId)).toMatchObject({
      occurredOn: "2026-10-13",
      amount: { minor: 4730 },
      receiptId: r.receiptId,
      pending: false,
    });
    expect(
      (await listSplits(s, bankId)).map((split) => [split.categoryCode, split.amountMinor]),
    ).toEqual([
      ["groceries", 4000],
      ["other", 730],
    ]);
    expect(t.published.filter((event) => event.name === "transactions.merged")).toEqual([
      { name: "transactions.merged", ids: [bankId] },
    ]);
  });

  it("чек до выписки — сначала наличная трата; после импорта привязан, наличная исчезает и остаток «Наличных» возвращается", async () => {
    const { s, t, cash, card, balance, bank, receipt, monthExpenses } = await setup();
    const r = await receipt();
    expect(await balance(cash)).toBe(-4730);
    expect(await monthExpenses()).toBe(4730);
    const bankId = await bank();
    expect(await monthExpenses()).toBe(9460);
    expect(await t.ops.matchBankOps(s, [bankId])).toEqual({ linked: 1, asked: 0 });
    expect(await monthExpenses()).toBe(4730);
    expect(await balance(cash)).toBe(0);
    expect(await balance(card)).toBe(-4730);
    expect(await t.ops.operationOfReceipt(s, r.receiptId)).toMatchObject({ id: bankId });
  });

  it("автосвязь сообщает: «Чек из Евроопта привязан…» с кнопкой «Это разные покупки» (undoToken связи, а не «Да/Нет»)", async () => {
    const { s, t, bank, receipt } = await setup();
    await bank();
    const r = await receipt({ method: "card" });
    await t.ops.matchReceipt(s, r.receiptId);
    expect(t.notices).toHaveLength(1);
    expect(t.notices[0]).toMatchObject({
      kind: "receipt-match",
      params: { store: "Евроопт", date: "12.10", bankDate: "13.10" },
    });
    expect(t.notices[0]?.undoToken).toEqual(expect.any(String));
    expect(t.notices[0]?.decisionId).toBeUndefined();
  });

  it("«Это разные покупки»: чек снова операция «без пары» (наличные списаны, разбивка на месте), у платежа банка нет разбивки; пару больше не предлагают", async () => {
    const { s, t, cash, balance, bank, receipt, monthExpenses, get } = await setup();
    const bankId = await bank();
    const r = await receipt();
    expect(await t.ops.matchReceipt(s, r.receiptId)).toBe("linked");
    expect(await balance(cash)).toBe(0);
    const undone = await t.actions.undo(s, t.notices[0]?.undoToken ?? "");
    expect(undone).toBe("undone");
    const back = await t.ops.operationOfReceipt(s, r.receiptId);
    expect(back).toMatchObject({ id: r.txId, source: "receipt", pending: false });
    expect(await balance(cash)).toBe(-4730);
    expect(await monthExpenses()).toBe(9460);
    expect(await listSplits(s, bankId)).toEqual([]);
    expect(await get(bankId)).toMatchObject({ receiptId: null, category: { code: "groceries" } });
    expect((await listSplits(s, r.txId)).map((split) => split.amountMinor)).toEqual([4000, 730]);
    expect(await t.ops.matchReceipt(s, r.receiptId)).toBe("none");
    expect(await t.ops.matchBankOps(s, [bankId])).toEqual({ linked: 0, asked: 0 });
  });
});

describe("TXN-10: несколько кандидатов или неуверенно — вопрос «одна покупка?»", () => {
  it("два платежа на ту же сумму — связь не автоматическая: один вопрос в actions, уведомление с decisionId", async () => {
    const { s, t, bank, receipt, monthExpenses } = await setup();
    await bank();
    await bank({ occurredOn: "2026-10-12" });
    const r = await receipt({ method: "card" });
    expect(await t.ops.matchReceipt(s, r.receiptId)).toBe("asked");
    expect(t.notices).toHaveLength(1);
    expect(t.notices[0]).toMatchObject({ kind: "receipt-match", decisionId: expect.any(String) });
    expect(t.notices[0]?.undoToken).toBeUndefined();
    expect(await monthExpenses()).toBe(14190);
    const decision = await t.actions.decision(s, t.notices[0]?.decisionId ?? "");
    expect(decision).toMatchObject({
      status: "pending",
      summary: { key: "decisions.receiptMatch" },
    });
  });

  it("«Да» связывает пару и отдаёт «Отменить»; повторно ту же пару не спрашивают", async () => {
    const { s, t, bank, receipt, monthExpenses } = await setup();
    const first = await bank();
    await bank({ occurredOn: "2026-10-12" });
    const r = await receipt({ method: "card" });
    await t.ops.matchReceipt(s, r.receiptId);
    const answered = await t.actions.answer(s, t.notices[0]?.decisionId ?? "", "yes", "web");
    expect(answered.status).toBe("yes");
    expect(answered.undoToken).toEqual(expect.any(String));
    expect(await monthExpenses()).toBe(9460);
    expect(await t.ops.operationOfReceipt(s, r.receiptId)).toMatchObject({ source: "statement" });
    void first;
  });

  it("«Нет» ничего не меняет, а ту же пару второй раз не предлагают: остаётся один платёж — он и становится единственным кандидатом", async () => {
    const { s, t, bank, receipt, monthExpenses } = await setup();
    const remaining = await bank();
    await bank({ occurredOn: "2026-10-12" });
    const r = await receipt({ method: "card" });
    await t.ops.matchReceipt(s, r.receiptId);
    await t.actions.answer(s, t.notices[0]?.decisionId ?? "", "no", "web");
    expect(await monthExpenses()).toBe(14190);
    expect(await t.ops.matchReceipt(s, r.receiptId)).toBe("linked");
    expect(await t.ops.operationOfReceipt(s, r.receiptId)).toMatchObject({ id: remaining });
    expect(t.notices).toHaveLength(2);
    expect(await t.ops.matchReceipt(s, r.receiptId)).toBe("none");
  });

  it("единственный платёж, но магазин непохож (порог похожести) — спрашиваем, а не связываем", async () => {
    const { s, t, bank, receipt } = await setup();
    await bank({
      merchantName: "Книжный двор",
      merchantKey: "KNIZHNY DVOR",
      description: "KNIZHNY DVOR MINSK",
    });
    const r = await receipt({ method: "card" });
    expect(await t.ops.matchReceipt(s, r.receiptId)).toBe("asked");
  });
});

describe("TXN-10: что не считается парой", () => {
  it("другая сумма, дата вне окна ±2 дня, не выписка, уже связанный платёж — не кандидаты", async () => {
    const { s, t, bank, receipt } = await setup();
    await bank({ amount: byn(4800), amountBynMinor: 4800 });
    await bank({ occurredOn: "2026-10-20" });
    const r = await receipt({ method: "card" });
    expect(await t.ops.matchReceipt(s, r.receiptId)).toBe("none");
    // допуск 0,01: разница в копейку — кандидат
    const near = await bank({ amount: byn(4731), amountBynMinor: 4731, occurredOn: "2026-10-12" });
    expect(await t.ops.matchReceipt(s, r.receiptId)).toBe("linked");
    expect((await t.ops.get(s, near)).transaction).toMatchObject({
      receiptId: r.receiptId,
      amount: { minor: 4731 },
    });
    // платёж уже связан с чеком — второй чек его не забирает
    const second = await receipt({ method: "card", receiptId: randomUUID() });
    expect(await t.ops.matchReceipt(s, second.receiptId)).toBe("none");
  });

  it("STMT-07: предварительные операции чеков не считаются дублями строк выписки", async () => {
    const { s, t, bank, receipt } = await setup();
    await receipt({ method: "card" });
    const key = "ключ-выписки-1";
    await bank({ dedupeKey: key });
    const known = await t.imports.knownKeys(s, { dedupeKeys: [key, "другой"], externalIds: [] });
    expect([...known.dedupe]).toEqual([key]);
  });

  it("чек без операции и операция чужого вида ничего не дают", async () => {
    const { s, t, bank } = await setup();
    expect(await t.ops.matchReceipt(s, randomUUID())).toBe("none");
    const manual = await bank({ type: "income", direction: "in" });
    expect(await t.ops.matchBankOps(s, [manual, randomUUID()])).toEqual({ linked: 0, asked: 0 });
  });
});

describe("TXN-11: ручная связь и разрыв из карточки", () => {
  it("связать вручную (сумма и день — из выписки), разорвать — чек возвращается; «Отменить» разрыв сливает снова", async () => {
    const { s, t, cash, balance, bank, receipt, monthExpenses } = await setup();
    const bankId = await bank({
      amount: byn(5000),
      amountBynMinor: 5000,
      occurredOn: "2026-10-20",
      merchantName: "Другой",
      merchantKey: "DRUGOY",
    });
    const r = await receipt();
    const linked = await t.ops.linkReceipt(s, { receiptId: r.receiptId, transactionId: bankId });
    expect(linked.undoToken).toEqual(expect.any(String));
    expect(await monthExpenses()).toBe(5000);
    // разбивка пересчитана под сумму выписки: 40,00 и 7,30 из 47,30 → пропорционально 50,00
    const splits = await listSplits(s, bankId);
    expect(splits.reduce((acc, split) => acc + split.amountMinor, 0)).toBe(5000);
    const unlinked = await t.ops.unlinkReceipt(s, bankId);
    expect(await monthExpenses()).toBe(9730);
    expect(await balance(cash)).toBe(-4730);
    expect(await t.ops.operationOfReceipt(s, r.receiptId)).toMatchObject({ source: "receipt" });
    expect(await t.actions.undo(s, unlinked.undoToken)).toBe("undone");
    expect(await monthExpenses()).toBe(5000);
    expect(await balance(cash)).toBe(0);
  });

  it("связать нельзя: платёж не расход выписки или уже с чеком, чек без операции — NOT_FOUND, разрыв без связи — CONFLICT", async () => {
    const { s, t, bank, receipt } = await setup();
    const manual = await bank({ type: "income", direction: "in" });
    const r = await receipt();
    await expect(
      t.ops.linkReceipt(s, { receiptId: r.receiptId, transactionId: manual }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      t.ops.linkReceipt(s, { receiptId: randomUUID(), transactionId: manual }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const plain = await bank();
    await expect(t.ops.unlinkReceipt(s, plain)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("чужой чек и чужая операция не связываются", async () => {
    const mine = await setup();
    const theirs = await setup();
    const bankId = await theirs.bank();
    const r = await mine.receipt();
    await expect(
      mine.t.ops.linkReceipt(mine.s, { receiptId: r.receiptId, transactionId: bankId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("RCPT-08: «Отменить» чек, слитый с выпиской", () => {
  it("операция банка остаётся, снимаются только разбивка и ссылка на чек", async () => {
    const { s, t, bank, receipt, get } = await setup();
    const bankId = await bank();
    const r = await receipt({ method: "card" });
    await t.ops.matchReceipt(s, r.receiptId);
    await s.transaction((tx) => t.ops.removeForReceipt(tx, r.receiptId));
    expect(await get(bankId)).toMatchObject({
      receiptId: null,
      needsReview: false,
      amount: { minor: 4730 },
    });
    expect(await listSplits(s, bankId)).toEqual([]);
  });
});
