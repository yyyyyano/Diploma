// STMT-03, STMT-04, STMT-06…STMT-11, CAT-06, NOTIF-02 на Postgres: полный путь выписки — разбор и предпросмотр (дубли,
// типы, курс НБРБ), импорт одной транзакцией, повторная загрузка, «Исправить колонки», откат, брошенный черновик.
// Соседи настоящие (accounts, actions, merchants, categories, запись transactions); файлы — в памяти, уведомления и
// модель — шпионы, курс НБРБ — карта в памяти (NFR-11).
import { FileId } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  newScope,
  transactionsWithJournal,
} from "../../../main/__fixtures__/transactions-with-journal.ts";
import { crossTenant } from "../../../platform/db/cross-tenant.ts";
import { findStaleDraftOwners } from "../infrastructure/db/statement-imports.repo.ts";
import { readDocument } from "../infrastructure/parsing/read-document.ts";
import type { FileType } from "../domain/types.ts";
import { loadCase } from "./__fixtures__/datasets.ts";
import { defaultSettings, scriptedLlm } from "./__fixtures__/scripted-llm.ts";
import { makeBuildPreview } from "./build-preview.ts";
import { makeImports, ROLLBACK_HANDLER } from "./imports.ts";
import { makeParseStatement } from "./parse-statement.ts";
import { makeRememberFormat } from "./remember-format.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const MIME: Record<string, string> = {
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

async function setup(answers: Record<string, unknown> = {}) {
  const s = newScope(db);
  const t = transactionsWithJournal(db, {
    rates: { USD: { rateDate: "2026-09-01", rateE4: 29_871, scale: 1 } },
  });
  const files = new Map<string, { kind: string; mime: string; bytes: Uint8Array }>();
  const filesFacade = {
    open: async (_s: unknown, id: string) => {
      const file = files.get(id);
      if (file === undefined) throw new Error("нет файла");
      return {
        kind: file.kind,
        mime: file.mime,
        blob: new Blob([new Uint8Array(file.bytes)]),
      } as never;
    },
    remove: async (_s: unknown, id: string) => {
      files.delete(id);
    },
  };
  const script = scriptedLlm(answers);
  const parse = makeParseStatement({
    reader: { read: (input) => readDocument(input, { timeoutMs: 30_000, memoryMb: 512 }) },
    llm: script.llm,
    files: filesFacade as never,
    settings: defaultSettings,
    log: t.platform.log,
  });
  const remember = makeRememberFormat({ clock: t.platform.clock });
  const buildPreview = makeBuildPreview({
    accounts: t.accounts,
    transactions: t.transactionsFacade,
    merchants: t.merchants,
    categories: t.categories,
    fxRates: t.fxRates,
    settings: defaultSettings,
  });
  const notifications: { kind: string; key: string; params?: unknown; decisionId?: string }[] = [];
  const parseJob = { name: "statements.parse" } as never;
  const discardJob = { name: "statements.discard-draft" } as never;
  const imports = makeImports({
    platform: { ...t.platform, settings: defaultSettings } as never,
    files: filesFacade as never,
    accounts: t.accounts,
    transactions: t.transactionsFacade as never,
    actions: t.actions,
    notifications: {
      notify: async (_s, input) => {
        notifications.push(input);
        return randomUUID();
      },
    },
    parseStatement: parse.parseStatement,
    buildPreview,
    remember,
    jobs: { parse: parseJob, discard: discardJob },
  });
  t.registerUndo(ROLLBACK_HANDLER, imports.rollback);
  const upload = (bytes: Uint8Array, type: FileType = "csv") => {
    const id = FileId.parse(randomUUID());
    files.set(id, { kind: "statement", mime: MIME[type] ?? "application/octet-stream", bytes });
    return id;
  };
  const uploadCase = (caseId: string) => {
    const item = loadCase(caseId);
    return upload(item.bytes, item.type);
  };
  /** Загрузка → задача parse (вручную) → готовый черновик. */
  const prepare = async (fileId: FileId) => {
    const { id } = await imports.start(s, fileId);
    await imports.run(s, id);
    return id;
  };
  const rows = async (sql: string, params: unknown[] = []) =>
    (await db.owner.query(sql, [s.scope.householdId, ...params])).rows;
  const balance = async (accountId: string) =>
    (await t.accounts.list(s)).items.find((item) => item.id === accountId)?.balance.minor;
  return {
    s,
    t,
    imports,
    notifications,
    upload,
    uploadCase,
    prepare,
    rows,
    balance,
    script,
    files,
  };
}

const text = (value: string) => new TextEncoder().encode(value);

describe("STMT-04, STMT-07: предпросмотр и импорт", () => {
  it("30 операций: предпросмотр «30 найдено, 0 дублей», импорт одной транзакцией, один сигнал и одно уведомление", async () => {
    const { s, t, imports, notifications, uploadCase, prepare, rows, balance } = await setup();
    const id = await prepare(uploadCase("lesbank-csv-september"));
    const draft = await imports.get(s, id);
    expect(draft).toMatchObject({
      status: "ready",
      bank: "Лесбанк",
      mask: "4821",
      currency: "BYN",
      found: 30,
      newCount: 30,
      duplicates: 0,
      balanceStatus: "ok",
      method: "detected",
    });
    const result = await imports.confirm(s, id);
    expect(result).toMatchObject({ imported: 30, duplicates: 0 });

    const imported = await rows(
      "select source, import_id, category_source, type from transactions where household_id = $1",
    );
    expect(imported).toHaveLength(30);
    expect(imported.every((r) => r.source === "statement" && r.import_id === id)).toBe(true);
    // Остаток счёта — из выписки (последний остаток колонки «Остаток»), источник «из выписки».
    const [account] = (await t.accounts.list(s)).items.filter((item) => item.kind === "card");
    const expected = loadCase("lesbank-csv-september").expected.rows.at(-1)?.balanceMinor;
    expect(account).toMatchObject({ balanceSource: "statement", mask: "4821" });
    expect(await balance(account?.id ?? "")).toBe(expected);
    // Одно transactions.changed на весь импорт, одно уведомление «импорт завершён».
    expect(t.published.filter((e) => e.name === "transactions.changed")).toHaveLength(1);
    expect(t.published.filter((e) => e.name === "statements.imported")).toHaveLength(1);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      kind: "statement-imported",
      key: id,
      params: { count: 30 },
    });
    expect(await imports.get(s, id)).toMatchObject({ status: "imported", payload: null });
  });

  it("КП STMT: повторная загрузка той же выписки — 0 новых и отчёт о дублях; в базе операций не прибавилось", async () => {
    const { s, imports, uploadCase, prepare, rows } = await setup();
    const first = await prepare(uploadCase("lesbank-csv-september"));
    await imports.confirm(s, first);
    const again = await prepare(uploadCase("lesbank-csv-september"));
    expect(await imports.get(s, again)).toMatchObject({ found: 30, newCount: 0, duplicates: 30 });
    const result = await imports.confirm(s, again);
    expect(result).toMatchObject({ imported: 0, duplicates: 30 });
    expect(await rows("select 1 from transactions where household_id = $1")).toHaveLength(30);
  });

  it("STMT-07: пересекающиеся выписки — только новые строки; два одинаковых кофе в одном файле — две операции", async () => {
    const { s, imports, upload, prepare, rows } = await setup();
    const head = "Дата;Описание операции;Приход;Расход;Остаток\n";
    const a = `${head}01.09.2026;Кофейня;;3,00;97,00\n01.09.2026;Кофейня;;3,00;94,00\n02.09.2026;Аптека;;10,00;84,00\n`;
    const b = `${head}01.09.2026;Кофейня;;3,00;97,00\n01.09.2026;Кофейня;;3,00;94,00\n02.09.2026;Аптека;;10,00;84,00\n03.09.2026;Магазин;;4,00;80,00\n`;
    const first = await prepare(upload(text(`Лесбанк\nКарта ****4821\n${a}`)));
    expect(await imports.get(s, first)).toMatchObject({ found: 3, newCount: 3 });
    await imports.confirm(s, first);
    const second = await prepare(upload(text(`Лесбанк\nКарта ****4821\n${b}`)));
    expect(await imports.get(s, second)).toMatchObject({ found: 4, duplicates: 3, newCount: 1 });
    await imports.confirm(s, second);
    expect(await rows("select 1 from transactions where household_id = $1")).toHaveLength(4);
  });
});

describe("STMT-08: типы операций", () => {
  const csv = (lines: string[]) =>
    text(`Лесбанк\nКарта ****4821\nДата;Описание операции;Приход;Расход\n${lines.join("\n")}\n`);

  it("снятие наличных — перевод с парой на «Наличные» (расходов нет); зарплата — доход; кредит — «Кредиты и займы»; возврат связан с покупкой", async () => {
    const { s, t, imports, upload, prepare, rows, balance } = await setup();
    const id = await prepare(
      upload(
        csv([
          "01.09.2026;EVROTORG T-0042 MINSK;;50,00",
          "02.09.2026;Снятие наличных ATM 55;;200,00",
          "03.09.2026;Зарплата за август;1500,00;",
          "04.09.2026;Погашение кредита по договору 7;;300,00",
          "05.09.2026;Возврат покупки EVROTORG T-0042 MINSK;20,00;",
        ]),
      ),
    );
    await imports.confirm(s, id);
    const list = await rows(
      "select type, direction, category_code, refund_of_id, description, account_id from transactions where household_id = $1 order by occurred_on, direction",
    );
    const byDescription = (part: string) =>
      list.filter((r) => String(r.description).includes(part));
    expect(byDescription("Снятие наличных").map((r) => r.type)).toEqual(["transfer", "transfer"]);
    expect(byDescription("Зарплата")[0]).toMatchObject({ type: "income", category_code: "salary" });
    expect(byDescription("кредит")[0]).toMatchObject({ type: "expense", category_code: "loans" });
    const refund = byDescription("Возврат")[0];
    const purchase = byDescription("EVROTORG T-0042 MINSK").find((r) => r.type === "expense");
    expect(refund).toMatchObject({ type: "refund", category_code: "refunds" });
    expect(refund?.refund_of_id).not.toBeNull();
    expect(purchase).toBeDefined();
    // Расходы месяца: покупка и кредит; снятие наличных в них не входит (перевод).
    const expenses = await rows(
      "select sum(amount_minor)::int as total from transactions where household_id = $1 and type = 'expense'",
    );
    expect(expenses[0]?.total).toBe(5_000 + 30_000);
    // Наличные выросли на 200,00.
    const cash = await s.transaction((tx) => t.accounts.cash(tx));
    expect(await balance(cash)).toBe(20_000);
  });

  it("спорный «Перевод на карту …» — расход пока, человеку — один вопрос «Да/Нет» на пакет", async () => {
    const { s, imports, upload, prepare, rows } = await setup();
    const id = await prepare(
      upload(
        csv(["01.09.2026;Перевод на карту 4000 ****;;10,00", "02.09.2026;Перевод Иван И.;;5,00"]),
      ),
    );
    expect(await imports.get(s, id)).toMatchObject({ doubtful: 2 });
    const { decisionId, imported } = await imports.confirm(s, id);
    expect(imported).toBe(2);
    expect(decisionId).toBeDefined();
    const pending = await rows(
      "select handler, status, summary from pending_decisions where household_id = $1",
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: "pending" });
    expect(
      await rows("select 1 from transactions where household_id = $1 and type = 'transfer'"),
    ).toHaveLength(0);
  });

  it("перевод на свой накопительный в паре с зачислением из другой выписки — оба переводы с парой, доходов и расходов нет", async () => {
    const { s, imports, upload, prepare, rows } = await setup();
    const savings = await prepare(
      upload(
        text(
          "Лесбанк\nКарта ****9999\nДата;Описание операции;Приход;Расход\n11.09.2026;Пополнение накопительного счёта;500,00;\n",
        ),
      ),
    );
    await imports.confirm(s, savings);
    const card = await prepare(
      upload(
        text(
          "Лесбанк\nКарта ****4821\nДата;Описание операции;Приход;Расход\n10.09.2026;Пополнение накопительного счёта;;500,00\n",
        ),
      ),
    );
    await imports.confirm(s, card);
    const pairs = await rows(
      "select id, type, transfer_pair_id from transactions where household_id = $1",
    );
    expect(pairs.map((r) => r.type)).toEqual(["transfer", "transfer"]);
    expect(pairs[0]?.transfer_pair_id).toBe(pairs[1]?.id);
    expect(pairs[1]?.transfer_pair_id).toBe(pairs[0]?.id);
  });
});

describe("STMT-09: валюта", () => {
  it("выписка в USD: сумма в BYN по курсу НБРБ на день операции, курс записан (id для «Откуда эта цифра?»)", async () => {
    const { s, imports, uploadCase, prepare, rows } = await setup();
    const id = await prepare(uploadCase("hamlet-xls-english"));
    expect(await imports.get(s, id)).toMatchObject({ currency: "USD", mask: "7788" });
    await imports.confirm(s, id);
    const [row] = await rows(
      "select amount_minor, amount_byn_minor, fx_rate_id, currency from transactions where household_id = $1 limit 1",
    );
    expect(row?.currency).toBe("USD");
    expect(row?.fx_rate_id).not.toBeNull();
    // 2,9871 BYN за 1 USD, половина от нуля до копейки.
    expect(Number(row?.amount_byn_minor)).toBe(
      Math.round((Number(row?.amount_minor) * 29_871) / 10_000),
    );
  });
});

describe("STMT-04, STMT-05: колонки и формат", () => {
  it("формат запоминается при импорте: вторая выписка того же формата — без модели", async () => {
    const { s, imports, uploadCase, prepare, script } = await setup();
    const first = await prepare(uploadCase("lesbank-csv-september"));
    await imports.confirm(s, first);
    const second = await prepare(uploadCase("lesbank-csv-october"));
    expect(await imports.get(s, second)).toMatchObject({
      method: "remembered",
      formatChanged: false,
    });
    expect(script.calls).toEqual([]);
  });

  it("«Исправить колонки»: роли человека, повторный разбор без модели; предпросмотр обновлён", async () => {
    const item = loadCase("csv-unknown-headers");
    const wrong = { columns: [{ index: 0, role: "ignore" }] };
    const { s, t, imports, uploadCase, script } = await setup({ "statement.columns": wrong });
    const { id } = await imports.start(s, uploadCase("csv-unknown-headers"));
    await imports.run(s, id);
    expect(await imports.get(s, id)).toMatchObject({
      status: "failed",
      errorCode: "STATEMENT_UNREADABLE",
    });
    expect(script.calls).toHaveLength(1);
    await imports.fixColumns(s, id, item.expected.columns ?? []);
    expect(t.enqueued.filter((job) => job.name === "statements.parse")).toBeDefined();
    expect(await imports.get(s, id)).toMatchObject({ status: "parsing" });
    await imports.run(s, id);
    expect(await imports.get(s, id)).toMatchObject({
      status: "ready",
      found: item.expected.rows.length,
    });
    // Модель при повторном разборе не звали.
    expect(script.calls).toHaveLength(1);
  });
});

describe("STMT-11: откат импорта", () => {
  it("откат удаляет все операции импорта, правленные вручную тоже; остаток возвращается; чужой импорт цел", async () => {
    const { s, t, imports, uploadCase, prepare, rows, balance } = await setup();
    const first = await prepare(uploadCase("lesbank-csv-september"));
    await imports.confirm(s, first);
    const second = await prepare(uploadCase("lesbank-csv-october"));
    await imports.confirm(s, second);
    const account = (await t.accounts.list(s)).items.find((item) => item.kind === "card");
    const afterBoth = await balance(account?.id ?? "");
    // Одну операцию первого импорта правят вручную.
    const [edited] = await rows(
      "select id from transactions where household_id = $1 and import_id = $2 limit 1",
      [first],
    );
    await t.ops.update(
      s,
      { id: edited?.id as never, patch: { note: "моя заметка" } },
      { channel: "web", source: "manual" },
    );
    expect(await imports.rollbackInfo(s, first)).toEqual({ transactions: 30, edited: 1 });
    expect(await imports.requestRollback(s, first)).toEqual({ status: "undone" });
    expect(
      await rows("select 1 from transactions where household_id = $1 and import_id = $2", [first]),
    ).toHaveLength(0);
    expect(
      await rows("select 1 from transactions where household_id = $1 and import_id = $2", [second]),
    ).toHaveLength(26);
    expect(await imports.get(s, first)).toMatchObject({ status: "rolled-back" });
    expect(t.published.filter((e) => e.name === "statements.rolled-back")).toHaveLength(1);
    // Остаток сдвинулся ровно на поправку и операции первого импорта; второй импорт цел.
    expect(await balance(account?.id ?? "")).not.toBe(afterBoth);
    // Повторное «Отменить» — безопасно.
    expect(await imports.requestRollback(s, first).catch((e: unknown) => e)).toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("Черновики", () => {
  it("«Отмена» удаляет черновик и файл; чужой черновик недоступен", async () => {
    const { s, imports, uploadCase, prepare, files } = await setup();
    const fileId = uploadCase("lesbank-csv-september");
    const id = await prepare(fileId);
    await expect(imports.get(newScope(db), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await imports.cancel(s, id);
    await expect(imports.get(s, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(files.has(fileId)).toBe(false);
  });

  it("брошенный черновик удаляется после TTL, свежий — остаётся", async () => {
    const { s, imports, uploadCase, prepare, files, rows } = await setup();
    const fileId = uploadCase("lesbank-csv-september");
    const id = await prepare(fileId);
    await imports.discard(s, id);
    expect(await imports.get(s, id)).toMatchObject({ status: "ready" });
    await db.owner.query(
      "update statement_imports set updated_at = timestamptz '2026-10-10' where id = $1",
      [id],
    );
    await imports.discard(s, id);
    expect(await rows("select 1 from statement_imports where household_id = $1")).toHaveLength(0);
    expect(files.has(fileId)).toBe(false);
  });

  it("повторный «Импортировать» уже импортированного — CONFLICT, операций не прибавляется", async () => {
    const { s, imports, uploadCase, prepare, rows } = await setup();
    const id = await prepare(uploadCase("lesbank-csv-september"));
    await imports.confirm(s, id);
    await expect(imports.confirm(s, id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await rows("select 1 from transactions where household_id = $1")).toHaveLength(30);
  });
});

describe("Обход брошенных черновиков", () => {
  it("находит владельцев давних черновиков (предпросмотр, ошибка) и не трогает свежие и импортированные", async () => {
    const { s, uploadCase, prepare, imports, confirmOf } = await setup().then((env) => ({
      ...env,
      confirmOf: env.imports.confirm,
    }));
    const stale = await prepare(uploadCase("lesbank-csv-september"));
    const fresh = await prepare(uploadCase("lesbank-csv-october"));
    const done = await prepare(uploadCase("lesbank-csv-changed"));
    await confirmOf(s, done);
    // Часы тестов — фиктивные (2026-10-28), а обход сверяет с now() базы: возраст задаём явно.
    await db.owner.query(
      "update statement_imports set updated_at = now() - interval '3 days' where id in ($1, $2)",
      [stale, done],
    );
    await db.owner.query("update statement_imports set updated_at = now() where id = $1", [fresh]);
    const owners = await crossTenant(db.pool, "test.stale-drafts", findStaleDraftOwners);
    const mine = owners.filter((owner) => owner.householdId === s.scope.householdId);
    expect(mine.map((owner) => owner.id)).toEqual([stale]);
    expect(mine[0]).toMatchObject({ userId: s.scope.userId });
    expect(fresh).not.toBe(stale);
    expect(await imports.get(s, fresh)).toMatchObject({ status: "ready" });
  });
});
