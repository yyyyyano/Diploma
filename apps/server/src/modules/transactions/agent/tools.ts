// Инструменты агента модуля transactions (AGT-03 «операции», AGT-05, AGT-07, ADR-0009): описание — по-английски и
// коротко, вход без владельца (данные — только ctx.s), выход — карточки из @kosht/contract. Поиск — read; добавить и
// изменить — сразу с undoToken; удалить — только ожидающее решение (destructive), исполняет его «Да» человека.
// Агрегации (суммы по категориям, месяцам, контрагентам) — `aggregate_transactions` (T-031), числа считает calc.
//
// Входные схемы — плоские и лёгкие (id — строка в 36 знаков, день — «ГГГГ-ММ-ДД», сумма — число копеек): префикс агента
// (подсказка + инструменты набора core) ограничен 3 000 токенов (CONSTRAINTS), а полные схемы контракта (uuid и дата
// с регулярками, `CategoryRef` с перечислением кодов в каждом поле) занимали втрое больше. Строгая проверка — в
// execute: бренды и `LocalDate` разбираются схемами контракта, неверное — `VALIDATION`. Категорию при добавлении
// подбирает сервер (правила, затем модель) — ассистенту её называть не нужно.
import {
  AccountId,
  AggregateGroup,
  CreateTransactionInput,
  RowCount,
  SystemCategoryCode,
  Transaction,
  TransactionAggregate,
  TransactionId,
  TransactionType,
  UndoToken,
  UpdateResult,
} from "@kosht/contract";
import { LocalDate, Money } from "@kosht/kernel";
import { z } from "zod";
import { AppError } from "../../../platform/errors/app-error.ts";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Operations } from "../application/operations.ts";

/** Название категории словами («Кафе, рестораны и доставка»): по коду `cafes` модель называла бы категорию как придётся. */
const CategoryName = z.string().nullable();
const Change = z.strictObject({
  transaction: Transaction,
  undoToken: UndoToken,
  categoryName: CategoryName,
});
const Changed = UpdateResult.extend({ categoryName: CategoryName });
/** Итоги периода; у групп-категорий — название словами (по ключу `system:taxi` модель писала бы «taxi»). */
const AggregateWithNames = TransactionAggregate.extend({
  groups: z.array(AggregateGroup.extend({ label: z.string().nullable() })).max(100),
});

const Id = z.string().length(36);
// Строгий разбор дня — в execute (`LocalDate`); в схеме только длина: регулярка в JSON-схеме дороже в токенах.
const Day = z.string().length(10);

/** Разбор строки схемой контракта: не по схеме — `VALIDATION` (ассистент поправит вызов), а не сбой программы. */
function parsed<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("VALIDATION");
  return result.data;
}

/** День «ГГГГ-ММ-ДД» из аргумента модели: несуществующий («2026-02-31») — `VALIDATION`. */
function day(value: string): LocalDate {
  try {
    return LocalDate.parse(value);
  } catch {
    throw new AppError("VALIDATION");
  }
}

/** Сумма в копейках: целое и больше нуля (знак задаёт тип операции). */
function minor(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new AppError("VALIDATION");
  return value;
}

export function transactionsTools(ops: Operations) {
  /** Название категории операции словами; нет категории (перевод) — null. */
  const nameOf = async (
    s: Parameters<Operations["categoryLabel"]>[0],
    category: Parameters<Operations["categoryLabel"]>[1] | null,
  ): Promise<string | null> => (category === null ? null : ops.categoryLabel(s, category));

  /** Название группы итогов: встроенная категория — словами, остальное (месяц, контрагент, своя категория) — ключ как есть. */
  const groupLabel = async (
    s: Parameters<Operations["categoryLabel"]>[0],
    groupBy: "category" | "month" | "counterparty",
    key: string,
  ): Promise<string | null> => {
    const code = groupBy === "category" && key.startsWith("system:") ? key.slice(7) : undefined;
    const parsedCode = SystemCategoryCode.safeParse(code);
    return parsedCode.success
      ? ops.categoryLabel(s, { type: "system", code: parsedCode.data })
      : null;
  };

  return {
    aggregate: defineTool({
      name: "aggregate_transactions",
      toolset: "core",
      kind: "read",
      description:
        "Income and expense totals in BYN for a period by category, month or counterparty (no transfers; refunds reduce expenses).",
      input: z.object({
        from: Day,
        to: Day,
        group_by: z.enum(["category", "month", "counterparty"]),
      }),
      output: AggregateWithNames,
      execute: async (ctx, input) => {
        const result = await ops.aggregateWithTraces(ctx.s, {
          from: parsed(LocalDate.schema, input.from),
          to: parsed(LocalDate.schema, input.to),
          groupBy: input.group_by,
        });
        return {
          ...result,
          groups: await Promise.all(
            result.groups.map(async (group) => ({
              ...group,
              label: await groupLabel(ctx.s, input.group_by, group.key),
            })),
          ),
        };
      },
    }),
    search: defineTool({
      name: "search_transactions",
      toolset: "core",
      kind: "read",
      description:
        "Find transactions, newest first; filters optional; amounts in kopecks. Returns up to `limit` rows (max 50) and the total.",
      input: z.strictObject({
        query: z.string().max(100).optional(),
        from: Day.optional(),
        to: Day.optional(),
        type: TransactionType.optional(),
        categoryCode: SystemCategoryCode.optional(),
        accountId: Id.optional(),
        minAmount: z.number().optional(),
        maxAmount: z.number().optional(),
        limit: z.number().max(50).optional(),
      }),
      output: z.strictObject({ items: z.array(Transaction), total: RowCount }),
      execute: async (ctx, input) => {
        const page = await ops.list(ctx.s, {
          page: 1,
          pageSize: Math.min(50, Math.max(1, Math.trunc(input.limit ?? 20))),
          ...(input.query === undefined ? {} : { query: input.query }),
          ...(input.from === undefined ? {} : { from: day(input.from) }),
          ...(input.to === undefined ? {} : { to: day(input.to) }),
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.categoryCode === undefined ? {} : { categoryCode: input.categoryCode }),
          ...(input.accountId === undefined
            ? {}
            : { accountId: parsed(AccountId, input.accountId) }),
          ...(input.minAmount === undefined ? {} : { amountFrom: Math.trunc(input.minAmount) }),
          ...(input.maxAmount === undefined ? {} : { amountTo: Math.trunc(input.maxAmount) }),
        });
        return { items: page.items, total: page.total };
      },
    }),
    add: defineTool({
      name: "add_transaction",
      toolset: "core",
      kind: "write",
      description:
        "Record a transaction. Amount in kopecks, positive. merchant = where or on what, in the user's words (coffee, a shop): the category is chosen from it. Default account: cash (BYN). Returns an undo token.",
      input: z.strictObject({
        type: TransactionType,
        amountMinor: z.number(),
        date: Day,
        merchant: z.string().max(120).optional(),
        note: z.string().max(500).optional(),
        accountId: Id.optional(),
        currency: z.string().length(3).optional(),
      }),
      output: Change,
      execute: async (ctx, input) => {
        const accountId =
          input.accountId === undefined ? undefined : parsed(AccountId, input.accountId);
        const currency =
          input.currency ??
          (accountId === undefined ? "BYN" : await ops.accountCurrency(ctx.s, accountId));
        const request = parsed(CreateTransactionInput, {
          ...(accountId === undefined ? {} : { accountId }),
          type: input.type,
          occurredOn: day(input.date),
          amount: Money.of(minor(input.amountMinor), currency.toUpperCase()),
          ...(input.merchant === undefined ? {} : { merchant: input.merchant }),
          ...(input.note === undefined ? {} : { note: input.note }),
        });
        const created = await ops.create(ctx.s, request, {
          channel: ctx.channel,
          source: "assistant",
        });
        return { ...created, categoryName: await nameOf(ctx.s, created.transaction.category) };
      },
    }),
    update: defineTool({
      name: "update_transaction",
      toolset: "core",
      kind: "write",
      description:
        "Change a transaction by id (amount, date, merchant, note, category). Returns an undo token.",
      input: z.strictObject({
        id: Id,
        amountMinor: z.number().optional(),
        date: Day.optional(),
        merchant: z.string().max(120).optional(),
        note: z.string().max(500).optional(),
        categoryCode: SystemCategoryCode.optional(),
      }),
      output: Changed,
      execute: async (ctx, input) => {
        const id = parsed(TransactionId, input.id);
        const current =
          input.amountMinor === undefined ? undefined : (await ops.get(ctx.s, id)).transaction;
        const updated = await ops.update(
          ctx.s,
          {
            id,
            patch: {
              ...(current === undefined || input.amountMinor === undefined
                ? {}
                : { amount: Money.of(minor(input.amountMinor), current.amount.currency) }),
              ...(input.date === undefined ? {} : { occurredOn: day(input.date) }),
              ...(input.merchant === undefined ? {} : { merchant: input.merchant }),
              ...(input.note === undefined ? {} : { note: input.note }),
              ...(input.categoryCode === undefined
                ? {}
                : { category: { type: "system" as const, code: input.categoryCode } }),
            },
          },
          { channel: ctx.channel, source: "assistant" },
        );
        return { ...updated, categoryName: await nameOf(ctx.s, updated.transaction.category) };
      },
    }),
    changeCategory: defineTool({
      name: "bulk_change_category",
      toolset: "core",
      kind: "destructive",
      description:
        "Ask to move transactions to a category. Nothing changes until the user says yes.",
      input: z.strictObject({
        ids: z.array(Id).min(1).max(50),
        categoryCode: z.string().max(20),
      }),
      propose: async (ctx, input) => ({
        decisionId: await ops.requestChangeCategory(
          ctx.s,
          input.ids.map((id) => parsed(TransactionId, id)),
          { type: "system", code: parsed(SystemCategoryCode, input.categoryCode) },
          ctx.channel,
        ),
        count: new Set(input.ids).size,
      }),
    }),
    remove: defineTool({
      name: "delete_transaction",
      toolset: "core",
      kind: "destructive",
      description: "Ask to delete transactions. Nothing is deleted until the user says yes.",
      input: z.strictObject({ ids: z.array(Id).min(1).max(50) }),
      propose: async (ctx, input) => ({
        decisionId: await ops.requestDelete(
          ctx.s,
          input.ids.map((id) => parsed(TransactionId, id)),
          ctx.channel,
        ),
        count: new Set(input.ids).size,
      }),
    }),
  };
}
