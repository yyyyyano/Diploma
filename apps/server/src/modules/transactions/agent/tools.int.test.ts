// AGT-03 «операции», AGT-05, AGT-07, ROLE-01: инструменты без модели — поиск (компактно, с total), добавить и изменить
// сразу с undoToken (источник «ассистент», канал запуска), удалить — только ожидающее решение, операция на месте до «Да».
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  newScope,
  transactionsWithJournal,
} from "../../../main/__fixtures__/transactions-with-journal.ts";
import { transactionsTools } from "./tools.ts";

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
  await s.transaction((tx) => t.accounts.cash(tx));
  const tools = transactionsTools(t.ops);
  const ctx = (channel: "web" | "telegram" = "web") => ({ s, requestId: "tool-test", channel });
  return { s, t, tools, ctx };
}

const ADD = {
  type: "expense",
  amountMinor: 1500,
  date: "2026-10-21",
  merchant: "Кофейня «Зерно»",
};

describe("AGT-05: add_transaction и update_transaction — сразу, с «Отменить»", () => {
  it("«потратил 15 на кофе»: операция от ассистента в «Наличных», undoToken отменяет её", async () => {
    const { s, t, tools, ctx } = await setup();
    const result = await tools.add.execute(ctx(), tools.add.input.parse(ADD));
    expect(tools.add.output.parse(result)).toMatchObject({
      transaction: {
        source: "assistant",
        amount: { minor: 1500, currency: "BYN" },
        merchantName: "Кофейня «Зерно»",
        occurredOn: "2026-10-21",
      },
    });
    expect(await t.actions.undo(s, result.undoToken)).toBe("undone");
    expect((await t.ops.list(s, { page: 1, pageSize: 50 })).total).toBe(0);
  });

  it("ответ называет категорию словами («Кафе, рестораны и доставка»), а не кодом: по коду модель называла её как придётся", async () => {
    const { tools, ctx } = await setup();
    const result = await tools.add.execute(
      ctx(),
      tools.add.input.parse({ ...ADD, merchant: "кофе" }),
    );
    expect(result.categoryName).toBe("Кафе, рестораны и доставка");
    const edited = await tools.update.execute(
      ctx(),
      tools.update.input.parse({ id: result.transaction.id, categoryCode: "taxi" }),
    );
    expect(edited.categoryName).toBe("Такси");
  });

  it("из Telegram канал отмены и истории — telegram", async () => {
    const { s, t, tools, ctx } = await setup();
    const { transaction } = await tools.add.execute(ctx("telegram"), tools.add.input.parse(ADD));
    expect((await t.ops.get(s, transaction.id)).history[0]).toMatchObject({ channel: "telegram" });
  });

  it("update_transaction меняет сумму и возвращает undoToken; во входе нет владельца", async () => {
    const { t, s, tools, ctx } = await setup();
    const { transaction } = await tools.add.execute(ctx(), tools.add.input.parse(ADD));
    const edited = await tools.update.execute(
      ctx(),
      tools.update.input.parse({ id: transaction.id, amountMinor: 1800, categoryCode: "taxi" }),
    );
    expect(edited.transaction).toMatchObject({
      amount: { minor: 1800, currency: "BYN" },
      category: { type: "system", code: "taxi" },
      categorySource: "user",
    });
    expect(await t.actions.undo(s, edited.undoToken)).toBe("undone");
    expect(tools.update.input.safeParse({ id: transaction.id, householdId: "чужое" }).success).toBe(
      false,
    );
  });
});

describe("AGT-05: аргументы модели проверяются — неверное это VALIDATION, а не сбой", () => {
  it("несуществующий день, сумма 0 и дробная сумма — VALIDATION, операций не появилось", async () => {
    const { s, t, tools, ctx } = await setup();
    const bad = [
      { ...ADD, date: "2026-02-31" },
      { ...ADD, amountMinor: 0 },
      { ...ADD, amountMinor: 15.5 },
    ];
    for (const input of bad) {
      await expect(tools.add.execute(ctx(), tools.add.input.parse(input))).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
    expect((await t.ops.list(s, { page: 1, pageSize: 50 })).total).toBe(0);
  });

  it("счёт в долларах без валюты в запросе — сумма пишется в валюте счёта", async () => {
    const { s, t, tools, ctx } = await setup();
    const usd = await t.accounts.create(
      s,
      { kind: "card", name: "USD", bank: null, mask: null, currency: "USD", initialBalance: null },
      "web",
    );
    const { transaction } = await tools.add.execute(
      ctx(),
      tools.add.input.parse({ ...ADD, accountId: usd.account.id }),
    );
    expect(transaction.amount).toEqual({ minor: 1500, currency: "USD" });
  });
});

describe("AGT-03: search_transactions", () => {
  it("находит по тексту, отдаёт не больше limit строк и общее число", async () => {
    const { tools, ctx } = await setup();
    for (let i = 0; i < 3; i += 1) {
      await tools.add.execute(ctx(), tools.add.input.parse(ADD));
    }
    const found = await tools.search.execute(
      ctx(),
      tools.search.input.parse({ query: "зерно", limit: 2 }),
    );
    expect(found.items).toHaveLength(2);
    expect(found.total).toBe(3);
    expect(tools.search.input.safeParse({ limit: 51 }).success).toBe(false);
  });
});

describe("AGT-07: bulk_change_category — только решение «Да/Нет»", () => {
  it("propose создаёт решение с числом и категорией, операции не тронуты; «Да» переносит их", async () => {
    const { s, t, tools, ctx } = await setup();
    const first = await tools.add.execute(ctx(), tools.add.input.parse(ADD));
    const second = await tools.add.execute(
      ctx(),
      tools.add.input.parse({ ...ADD, date: "2026-10-22" }),
    );
    const ids = [first.transaction.id, second.transaction.id];
    const draft = await tools.changeCategory.propose(
      ctx(),
      tools.changeCategory.input.parse({ ids, categoryCode: "taxi" }),
    );
    expect(draft).toEqual({ decisionId: expect.any(String), count: 2 });
    const { decisionId } = draft;
    expect(await t.actions.decision(s, decisionId)).toMatchObject({
      summary: { key: "decisions.transactionsCategory", params: { count: 2, category: "Такси" } },
    });
    await t.actions.answer(s, decisionId, "yes", "web");
    const after = await t.ops.list(s, { page: 1, pageSize: 50 });
    expect(
      after.items.every(
        (item) => item.category?.type === "system" && item.category.code === "taxi",
      ),
    ).toBe(true);
  });

  it("неизвестный код категории и чужие id — VALIDATION и NOT_FOUND, решение не создаётся", async () => {
    const { tools, ctx } = await setup();
    const { transaction } = await tools.add.execute(ctx(), tools.add.input.parse(ADD));
    await expect(
      tools.changeCategory.propose(
        ctx(),
        tools.changeCategory.input.parse({ ids: [transaction.id], categoryCode: "такси" }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      tools.changeCategory.propose(
        ctx(),
        tools.changeCategory.input.parse({
          ids: ["0199c1a0-0000-7000-8000-0000000000aa"],
          categoryCode: "taxi",
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("CAT-05: update_transaction с категорией — правило и вопрос про прошлые в ответе", () => {
  it("исправление категории у операции с названием отдаёт applyToPast, когда есть прошлые", async () => {
    const { tools, ctx } = await setup();
    const rides = [];
    for (const date of ["2026-10-20", "2026-10-21"]) {
      rides.push(
        await tools.add.execute(
          ctx(),
          tools.add.input.parse({
            type: "expense",
            amountMinor: 740,
            date,
            merchant: "ТАКСИ 7788",
          }),
        ),
      );
    }
    const edited = await tools.update.execute(
      ctx(),
      tools.update.input.parse({ id: rides[0]?.transaction.id, categoryCode: "transport" }),
    );
    expect(tools.update.output.parse(edited).applyToPast).toMatchObject({ count: 1 });
  });
});

describe("AGT-07: delete_transaction — только решение «Да/Нет»", () => {
  it("propose создаёт решение с обработчиком transactions.delete; операция на месте, «Да» удаляет", async () => {
    const { s, t, tools, ctx } = await setup();
    const { transaction } = await tools.add.execute(ctx(), tools.add.input.parse(ADD));
    const draft = await tools.remove.propose(
      ctx(),
      tools.remove.input.parse({ ids: [transaction.id] }),
    );
    expect(draft).toEqual({ decisionId: expect.any(String), count: 1 });
    const { decisionId } = draft;
    expect((await t.ops.list(s, { page: 1, pageSize: 50 })).total).toBe(1);
    await t.actions.answer(s, decisionId, "yes", "web");
    expect((await t.ops.list(s, { page: 1, pageSize: 50 })).total).toBe(0);
  });

  it("описания инструментов — по-английски, виды: search — read, add и update — write, delete — destructive", async () => {
    const { tools } = await setup();
    expect([tools.search, tools.add, tools.update, tools.remove].map((tool) => tool.kind)).toEqual([
      "read",
      "write",
      "write",
      "destructive",
    ]);
  });
});

describe("FIN-01: aggregate_transactions", () => {
  it("итоги периода по категориям с traceId; вход — плоский (группировка enum), без владельца", async () => {
    const { tools, ctx } = await setup();
    await tools.add.execute(ctx(), tools.add.input.parse(ADD));
    const input = tools.aggregate.input.parse({
      from: "2026-10-01",
      to: "2026-10-31",
      group_by: "category",
    });
    const output = tools.aggregate.output.parse(await tools.aggregate.execute(ctx(), input));
    expect(output).toMatchObject({
      expense: { minor: 1_500, currency: "BYN" },
      income: { minor: 0 },
      missingRates: 0,
      truncated: false,
    });
    expect(output.groups).toHaveLength(1);
    // Название категории словами: по ключу «system:cafes» модель писала бы «cafes».
    expect(output.groups[0]).toMatchObject({
      key: "system:cafes",
      label: "Кафе, рестораны и доставка",
    });
  });

  it("день не по формату — VALIDATION, а не сбой программы", async () => {
    const { tools, ctx } = await setup();
    await expect(
      tools.aggregate.execute(ctx(), { from: "вчера", to: "2026-10-31", group_by: "month" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
