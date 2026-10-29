// Инструменты агента модуля transactions (AGT-03 «операции», AGT-05, AGT-07, ADR-0009): описание — по-английски и
// коротко, вход без владельца (данные — только ctx.s), выход — карточки из @kosht/contract. Поиск — read; добавить и
// изменить — сразу с undoToken; удалить — только ожидающее решение (destructive), исполняет его «Да» человека.
// Агрегации (суммы, средние, по категориям) — в T-031, здесь их нет намеренно.
import {
  CreateTransactionInput,
  RowCount,
  Transaction,
  TransactionId,
  TransactionSource,
  TransactionType,
  UndoToken,
  UpdateTransactionPatch,
  AccountId,
  CategoryId,
  SystemCategoryCode,
  LocalDate,
} from "@kosht/contract";
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Operations } from "../application/operations.ts";
import { DELETE_HANDLER } from "../application/remove.ts";

const Change = z.strictObject({ transaction: Transaction, undoToken: UndoToken });

/** Фильтры поиска агента: плоские, без страниц — компактный результат (≤ 50 строк) и `total`. */
const SearchInput = z.strictObject({
  query: z.string().trim().max(100).optional(),
  from: LocalDate.schema.optional(),
  to: LocalDate.schema.optional(),
  accountId: AccountId.optional(),
  categoryCode: SystemCategoryCode.optional(),
  categoryId: CategoryId.optional(),
  type: TransactionType.optional(),
  amountFrom: z.int().min(0).optional(),
  amountTo: z.int().min(0).optional(),
  source: TransactionSource.optional(),
  limit: z.int().min(1).max(50).default(20),
});

export function transactionsTools(ops: Operations) {
  return {
    search: defineTool({
      name: "search_transactions",
      toolset: "core",
      kind: "read",
      description:
        "Find the user's transactions by text, period, account, category, type, amount range (BYN minor units) or source. Newest first; returns up to `limit` rows and the total count.",
      input: SearchInput,
      output: z.strictObject({ items: z.array(Transaction), total: RowCount }),
      execute: async (ctx, input) => {
        const { limit, ...filters } = input;
        const page = await ops.list(ctx.s, { ...filters, page: 1, pageSize: limit });
        return { items: page.items, total: page.total };
      },
    }),
    add: defineTool({
      name: "add_transaction",
      toolset: "core",
      kind: "write",
      description:
        "Record an expense, income, transfer or refund. Account defaults to cash (BYN); the amount currency must match the account. Returns it with an undo token.",
      input: z.strictObject({ transaction: CreateTransactionInput }),
      output: Change,
      execute: (ctx, input) =>
        ops.create(ctx.s, input.transaction, { channel: ctx.channel, source: "assistant" }),
    }),
    update: defineTool({
      name: "update_transaction",
      toolset: "core",
      kind: "write",
      description:
        "Change fields of one transaction by id (amount, date, account, merchant, note, category, type). Returns it with an undo token.",
      input: z.strictObject({ id: TransactionId, patch: UpdateTransactionPatch }),
      output: Change,
      execute: (ctx, input) =>
        ops.update(ctx.s, input, { channel: ctx.channel, source: "assistant" }),
    }),
    remove: defineTool({
      name: "delete_transaction",
      toolset: "core",
      kind: "destructive",
      description:
        "Ask the user to confirm deleting transactions by id. Nothing is deleted until the user says yes.",
      input: z.strictObject({ ids: z.array(TransactionId).min(1).max(50) }),
      propose: async (ctx, input) => ({
        action: DELETE_HANDLER,
        payload: { decisionId: await ops.requestDelete(ctx.s, input.ids, ctx.channel) },
      }),
    }),
  };
}
