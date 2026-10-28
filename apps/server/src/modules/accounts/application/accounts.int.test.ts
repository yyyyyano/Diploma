// STMT-01, STMT-02, STMT-09, RCPT-10, P5, AGT-07 на Postgres: счета с остатком и датой; создать, переименовать,
// начальный остаток — сразу и с «Отменить» через настоящий журнал actions; удалить — только «Да» на ожидающее решение,
// служебные не удаляются; итоги в BYN по курсу НБРБ с курсом в трассе (explain); нет курса — итог не показан;
// фасад для transactions и statements; «Карта, не указана» — по первому обращению.
import { AccountId } from "@kosht/contract";
import { LocalDate, Money } from "@kosht/kernel";
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb, type ScopedDb } from "../../../platform/db/scoped-db.ts";
import { accountsWithJournal } from "./__fixtures__/accounts-with-journal.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

let household = 0;
function scoped(): ScopedDb {
  household += 1;
  return createScopedDb(db.pool, testScope({ user: household, household }));
}

const USD = { rateDate: "2026-10-28", rateE4: 29_871, scale: 1 };
const card = {
  kind: "card" as const,
  name: null,
  bank: "Беларусбанк",
  mask: "4821",
  currency: "BYN",
  initialBalance: Money.of(15_000, "BYN"),
};

describe("STMT-01, STMT-02: счёт с остатком и датой остатка", () => {
  it("создать карту: начальный остаток — остаток, дата — сегодня, «указан вами»; событие и сигнал", async () => {
    const s = scoped();
    const { accounts, published, signals } = accountsWithJournal();
    const { account } = await accounts.create(s, card, "web");
    expect(account).toMatchObject({
      kind: "card",
      bank: "Беларусбанк",
      mask: "4821",
      balance: { minor: 15_000, currency: "BYN" },
      initialBalance: { minor: 15_000, currency: "BYN" },
      balanceOn: "2026-10-28",
      balanceSource: "manual",
      balanceInByn: null,
      rate: null,
    });
    expect(published).toEqual([{ name: "accounts.balances-changed", ids: [account.id] }]);
    expect(signals).toEqual([{ entity: "account", ids: [account.id] }]);
  });

  it("такая же карта (банк без учёта регистра, маска, валюта) — CONFLICT; начальный остаток в чужой валюте — VALIDATION", async () => {
    const s = scoped();
    const { accounts } = accountsWithJournal();
    await accounts.create(s, card, "web");
    await expect(accounts.create(s, { ...card, bank: "БЕЛАРУСБАНК" }, "web")).rejects.toMatchObject(
      {
        code: "CONFLICT",
      },
    );
    await expect(
      accounts.create(s, { ...card, mask: "0001", initialBalance: Money.of(1, "USD") }, "web"),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("P5: переименовать и начальный остаток — с «Отменить»", () => {
  it("начальный остаток 150 → 200 сдвигает остаток на 50; «Отменить» — обратно; переименование — тоже", async () => {
    const s = scoped();
    const { accounts, actions } = accountsWithJournal();
    const { account } = await accounts.create(s, card, "web");
    const set = await accounts.setInitialBalance(
      s,
      { id: account.id, initialBalance: Money.of(20_000, "BYN") },
      "web",
    );
    expect(set.account.balance).toEqual({ minor: 20_000, currency: "BYN" });
    const renamed = await accounts.rename(s, { id: account.id, name: "Зарплатная" }, "web");
    expect(renamed.account.name).toBe("Зарплатная");
    expect(await actions.undo(s, renamed.undoToken)).toBe("undone");
    expect(await actions.undo(s, set.undoToken)).toBe("undone");
    expect((await accounts.list(s)).items).toMatchObject([
      { id: account.id, name: null, balance: { minor: 15_000 }, initialBalance: { minor: 15_000 } },
    ]);
  });

  it("«Отменить» создания — счёта больше нет", async () => {
    const s = scoped();
    const { accounts, actions } = accountsWithJournal();
    const { undoToken } = await accounts.create(s, card, "web");
    await actions.undo(s, undoToken);
    expect((await accounts.list(s)).items).toEqual([]);
  });

  it("начальный остаток в чужой валюте и чужой счёт — VALIDATION и NOT_FOUND", async () => {
    const own = scoped();
    const other = scoped();
    const { accounts } = accountsWithJournal();
    const { account } = await accounts.create(own, card, "web");
    await expect(
      accounts.setInitialBalance(
        own,
        { id: account.id, initialBalance: Money.of(1, "USD") },
        "web",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      accounts.rename(other, { id: account.id, name: "x" }, "web"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("AGT-07: удалить — только после «Да»", () => {
  it("запрос удаления — решение с названием счёта, счёт на месте; «Да» удаляет; повтор «Да» — без эффекта", async () => {
    const s = scoped();
    const { accounts, actions, published } = accountsWithJournal();
    const { account } = await accounts.create(s, card, "web");
    const decisionId = await accounts.requestDelete(s, account.id);
    expect(await actions.decision(s, decisionId)).toMatchObject({
      status: "pending",
      summary: { key: "decisions.accountDelete", params: { name: "Беларусбанк •• 4821" } },
    });
    expect((await accounts.list(s)).items).toHaveLength(1);
    expect(await actions.answer(s, decisionId, "yes", "web")).toEqual({
      status: "yes",
      undoToken: null,
    });
    expect(await actions.answer(s, decisionId, "yes", "web")).toEqual({
      status: "yes",
      undoToken: null,
    });
    expect((await accounts.list(s)).items).toEqual([]);
    expect(published.at(-1)).toEqual({ name: "accounts.balances-changed", ids: [account.id] });
  });

  it("«Нет» — счёт остаётся", async () => {
    const s = scoped();
    const { accounts, actions } = accountsWithJournal();
    const { account } = await accounts.create(
      s,
      { ...card, name: "Отпуск", kind: "savings" },
      "web",
    );
    const decisionId = await accounts.requestDelete(s, account.id);
    expect(await actions.decision(s, decisionId)).toMatchObject({
      summary: { params: { name: "Отпуск" } },
    });
    await actions.answer(s, decisionId, "no", "web");
    expect((await accounts.list(s)).items).toHaveLength(1);
  });

  it("STMT-01, RCPT-10: «Наличные» и «Карта, не указана» не удаляются — ACCOUNT_PROTECTED", async () => {
    const s = scoped();
    const { accounts } = accountsWithJournal();
    const cash = await s.transaction((tx) => accounts.cash(tx));
    const unknown = await s.transaction((tx) => accounts.unknownCard(tx));
    await expect(accounts.requestDelete(s, cash)).rejects.toMatchObject({
      code: "ACCOUNT_PROTECTED",
    });
    await expect(accounts.requestDelete(s, unknown)).rejects.toMatchObject({
      code: "ACCOUNT_PROTECTED",
    });
    await expect(
      s.transaction((tx) => accounts.confirmDelete(tx, { accountId: cash })),
    ).rejects.toMatchObject({ code: "ACCOUNT_PROTECTED" });
  });
});

describe("STMT-09: итоги в BYN по курсу НБРБ", () => {
  it("BYN + USD: эквивалент USD и итог в BYN; накопительный — не в «Доступно»; курс на сегодня", async () => {
    const s = scoped();
    const { accounts, rateCalls } = accountsWithJournal({ USD });
    await accounts.create(s, card, "web");
    await accounts.create(
      s,
      { ...card, mask: "2208", currency: "USD", initialBalance: Money.of(32_000, "USD") },
      "web",
    );
    await accounts.create(
      s,
      { ...card, kind: "savings", mask: "5530", initialBalance: Money.of(215_000, "BYN") },
      "web",
    );
    const list = await accounts.list(s);
    expect(list.items[1]).toMatchObject({
      balance: { minor: 32_000, currency: "USD" },
      balanceInByn: { minor: 95_587, currency: "BYN" },
      rate: { rateE4: 29_871, scale: 1, date: "2026-10-28" },
    });
    expect(list.totals).toEqual({
      total: { minor: 15_000 + 95_587 + 215_000, currency: "BYN" },
      available: { minor: 15_000 + 95_587, currency: "BYN" },
      missingRates: [],
    });
    expect(rateCalls.at(-1)).toBe("USD:2026-10-28");
  });

  it("курса нет — эквивалент и итоги null (не 0), валюта названа; «Откуда?» — UNAVAILABLE", async () => {
    const s = scoped();
    const { accounts } = accountsWithJournal();
    const { account } = await accounts.create(
      s,
      { ...card, currency: "EUR", initialBalance: Money.of(1_000, "EUR") },
      "web",
    );
    const list = await accounts.list(s);
    expect(list.items[0]).toMatchObject({ balanceInByn: null, rate: null });
    expect(list.totals).toEqual({ total: null, available: null, missingRates: ["EUR"] });
    await expect(accounts.explain(s, { kind: "total" })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await expect(accounts.explain(s, { kind: "account", id: account.id })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  it("EXPL-01: «Откуда эта цифра?» итога и эквивалента — сохранённая трасса с курсом НБРБ", async () => {
    const s = scoped();
    const { accounts, explain } = accountsWithJournal({ USD });
    const { account } = await accounts.create(
      s,
      { ...card, currency: "USD", initialBalance: Money.of(32_000, "USD") },
      "web",
    );
    const own = await accounts.explain(s, { kind: "account", id: account.id });
    expect(await explain.get(s, own)).toMatchObject({
      trace: {
        key: "accounts.balanceInByn",
        value: { minor: 95_587, currency: "BYN" },
        inputs: [
          { key: "accounts.balance" },
          { key: "fx.rate", value: 29_871, refs: [{ kind: "fxRate", id: "fx-USD-2026-10-28" }] },
          { key: "fx.scale", value: 1 },
        ],
      },
      period: { from: "2026-10-28", to: "2026-10-28" },
    });
    const total = await accounts.explain(s, { kind: "total" });
    expect((await explain.get(s, total)).trace).toMatchObject({ key: "accounts.total" });
    const available = await accounts.explain(s, { kind: "available" });
    expect((await explain.get(s, available)).trace.key).toBe("accounts.available");
    await accounts.create(s, { ...card, mask: "0002" }, "web");
    const byn = (await accounts.list(s)).items.find((item) => item.mask === "0002");
    const bynTrace = await accounts.explain(s, { kind: "account", id: AccountId.parse(byn?.id) });
    expect((await explain.get(s, bynTrace)).trace).toMatchObject({
      key: "accounts.balance",
      value: { minor: 15_000, currency: "BYN" },
    });
  });

  it("чужой счёт в «Откуда?» — NOT_FOUND", async () => {
    const own = scoped();
    const other = scoped();
    const { accounts } = accountsWithJournal();
    const { account } = await accounts.create(other, card, "web");
    await expect(accounts.explain(own, { kind: "account", id: account.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("фасад для transactions и statements", () => {
  it("карта по банку + маске + валюте: первый раз создаётся, дальше — та же", async () => {
    const s = scoped();
    const { accounts } = accountsWithJournal();
    const key = { bank: "Приорбанк", mask: "0937", currency: "BYN" };
    const first = await s.transaction((tx) => accounts.findOrCreate(tx, key));
    const second = await s.transaction((tx) =>
      accounts.findOrCreate(tx, { ...key, bank: "приорбанк" }),
    );
    expect(second).toBe(first);
    expect((await accounts.list(s)).items).toMatchObject([
      { id: first, kind: "card", balanceSource: "operations" },
    ]);
  });

  it("STMT-02: изменение остатка — по операциям, дата остатка не уходит назад; чужая валюта — ошибка программы", async () => {
    const s = scoped();
    const { accounts, published } = accountsWithJournal();
    const id = await s.transaction((tx) => accounts.cash(tx));
    const apply = (minor: number, on: string) =>
      s.transaction((tx) =>
        accounts.applyBalanceChange(tx, {
          accountId: id,
          delta: Money.of(minor, "BYN"),
          on: LocalDate.parse(on),
        }),
      );
    await apply(-1_500, "2026-10-30");
    await apply(500, "2026-10-29");
    expect((await accounts.list(s)).items).toMatchObject([
      { id, balance: { minor: -1_000 }, balanceOn: "2026-10-30", balanceSource: "operations" },
    ]);
    expect(published.filter((p) => p.name === "accounts.balances-changed")).toHaveLength(2);
    await expect(
      s.transaction((tx) =>
        accounts.applyBalanceChange(tx, {
          accountId: id,
          delta: Money.of(1, "USD"),
          on: LocalDate.parse("2026-10-30"),
        }),
      ),
    ).rejects.toThrow(RangeError);
  });

  it("RCPT-10: «Карта, не указана» — только при первом обращении, одна; «Наличные» — одни", async () => {
    const s = scoped();
    const { accounts } = accountsWithJournal();
    expect((await accounts.list(s)).items).toEqual([]);
    const [a, b] = await Promise.all([
      s.transaction((tx) => accounts.unknownCard(tx)),
      s.transaction((tx) => accounts.unknownCard(tx)),
    ]);
    expect(a).toBe(b);
    const cash = await s.transaction((tx) => accounts.cash(tx));
    expect(await s.transaction((tx) => accounts.cash(tx))).toBe(cash);
    expect((await accounts.list(s)).items.map((item) => item.kind)).toEqual([
      "cash",
      "unknown-card",
    ]);
  });
});
