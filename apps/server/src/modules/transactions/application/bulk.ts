// Массовые действия над выбранными операциями (TXN-04, AGT-07, P5): сменить категорию, пометить переводом — только
// через ожидающее решение «Да/Нет» с числом и примерами («Да, перенести 13»); «Да» исполняет код в одной транзакции,
// одна пачка ревизий — одно «Отменить» возвращает всё как было. Удаление пачкой — тот же обработчик, что у одной
// операции (remove.ts). Здесь же применение правила из исправления к прошлым операциям (CAT-05): тот же механизм.
import { SYSTEM_CATEGORIES, type CategoryRef } from "@kosht/contract";
import { createT } from "@kosht/i18n";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { categoryKindsOf, type TransactionType } from "../domain/transactions.ts";
import {
  findMany,
  listByMerchantKey,
  lockMany,
  updateTransaction,
  type TransactionRow,
} from "../infrastructure/db/transactions.repo.ts";
import type { Change } from "./ledger.ts";
import type { Deps, Parts } from "./deps.ts";
import { categoryRefOf, sameCategory } from "./mapping.ts";
import { exampleLabels } from "./remove.ts";
import { CATEGORY_HANDLER, RESTORE_HANDLER, TRANSFER_HANDLER } from "./handlers.ts";

const t = createT();
const Channel = z.enum(["web", "telegram"]);
const Ref = z.discriminatedUnion("type", [
  z.object({ type: z.literal("system"), code: z.string() }),
  z.object({ type: z.literal("custom"), id: z.string() }),
]);
const CategoryPayload = z.object({
  ids: z.array(z.uuid()).min(1),
  category: Ref,
  channel: Channel,
});
const TransferPayload = z.object({ ids: z.array(z.uuid()).min(1), channel: Channel });
const ApplyPayload = z.object({
  merchantKey: z.string().min(1),
  category: Ref,
  channel: Channel,
});

function columns(category: CategoryRef, source: string) {
  return {
    categoryCode: category.type === "system" ? category.code : null,
    categoryId: category.type === "custom" ? category.id : null,
    categorySource: source,
  };
}

export function makeBulk(d: Deps, parts: Parts) {
  const { clock, log } = d.platform;

  /** Название категории для вопроса: встроенной — из словаря, своей — как назвал человек (чужая — NOT_FOUND). */
  async function categoryLabel(s: ScopedDb, ref: CategoryRef): Promise<string> {
    if (ref.type === "system") {
      if (!SYSTEM_CATEGORIES.some((category) => category.code === ref.code)) {
        throw new AppError("NOT_FOUND");
      }
      return t(`categories:system.${ref.code}`);
    }
    const found = (await d.categories.list(s)).items.find(
      (item) => item.ref.type === "custom" && item.ref.id === ref.id,
    );
    if (found === undefined) throw new AppError("NOT_FOUND");
    return found.name ?? "";
  }

  async function ownRows(s: ScopedDb, ids: readonly string[]): Promise<TransactionRow[]> {
    const unique = [...new Set(ids)];
    const rows = await findMany(s, unique);
    if (rows.length !== unique.length) throw new AppError("NOT_FOUND");
    return rows;
  }

  /** Подходит ли категория типу операции (перевод — никакой; возврат — любая). */
  async function fits(s: ScopedDb, row: TransactionRow, category: CategoryRef): Promise<boolean> {
    return parts.prepare.accepts(s, row.type as TransactionType, category);
  }

  /** TXN-04, AGT-07: «Перенести N операций в «Такси»?» — решение; операции не тронуты до «Да». */
  async function requestChangeCategory(
    s: ScopedDb,
    ids: readonly string[],
    category: CategoryRef,
    channel: "web" | "telegram",
  ): Promise<string> {
    const rows = await ownRows(s, ids);
    for (const row of rows) {
      if (!(await fits(s, row, category))) throw new AppError("VALIDATION", { reason: "category" });
    }
    return d.actions.propose(s, {
      handler: CATEGORY_HANDLER,
      payload: { ids: rows.map((row) => row.id), category, channel },
      summary: {
        key: "decisions.transactionsCategory",
        params: {
          count: rows.length,
          category: await categoryLabel(s, category),
          examples: exampleLabels(rows),
        },
      },
    });
  }

  /** TXN-04, AGT-07: «Пометить N операций переводом?» — решение; у перевода категории нет. */
  async function requestMarkTransfer(
    s: ScopedDb,
    ids: readonly string[],
    channel: "web" | "telegram",
  ): Promise<string> {
    const rows = await ownRows(s, ids);
    return d.actions.propose(s, {
      handler: TRANSFER_HANDLER,
      payload: { ids: rows.map((row) => row.id), channel },
      summary: {
        key: "decisions.transactionsTransfer",
        params: { count: rows.length, examples: exampleLabels(rows) },
      },
    });
  }

  /** Записать изменённые строки одной пачкой: версия +1, ревизии, остатки, событие; вернуть undoToken «Отменить». */
  async function commit(
    tx: ScopedDb,
    rows: readonly TransactionRow[],
    patchOf: (row: TransactionRow) => Partial<Parameters<typeof updateTransaction>[2]>,
    channel: "web" | "telegram",
  ): Promise<string | undefined> {
    if (rows.length === 0) return undefined;
    const batchId = randomUUID();
    const changes: Change[] = [];
    for (const row of rows) {
      await updateTransaction(tx, row.id, {
        ...patchOf(row),
        version: row.version + 1,
        updatedAt: clock.now(),
      });
    }
    const after = new Map(
      (
        await findMany(
          tx,
          rows.map((row) => row.id),
        )
      ).map((row) => [row.id, row]),
    );
    for (const row of rows) {
      const next = after.get(row.id);
      if (next === undefined)
        throw new Error("transactions: операция пропала после массовой правки.");
      changes.push({ before: row, after: next });
    }
    await parts.ledger.settle(tx, { batchId, channel, changes });
    return d.actions.record(tx, {
      handler: RESTORE_HANDLER,
      payload: { batchId },
      subject: `transactions:${batchId}`,
      channel,
    });
  }

  /** «Да» (confirm): сменить категорию выбранным, кому она подходит и у кого она иная; источник — «выбрана вами». */
  async function confirmChangeCategory(
    tx: ScopedDb,
    payload: unknown,
  ): Promise<string | undefined> {
    const { ids, category, channel } = CategoryPayload.parse(payload);
    const ref = category as CategoryRef;
    const rows = [];
    for (const row of await lockMany(tx, ids)) {
      const same = sameCategory(categoryRefOf(row), ref);
      if (!same && (await fits(tx, row, ref))) rows.push(row);
    }
    log.info({ count: rows.length }, "transactions.bulk-category");
    return commit(tx, rows, () => columns(ref, "user"), channel);
  }

  /** «Да» (confirm): пометить переводом — тип «перевод», категории нет, направление и сумма прежние. */
  async function confirmMarkTransfer(tx: ScopedDb, payload: unknown): Promise<string | undefined> {
    const { ids, channel } = TransferPayload.parse(payload);
    const rows = (await lockMany(tx, ids)).filter((row) => row.type !== "transfer");
    log.info({ count: rows.length }, "transactions.bulk-transfer");
    return commit(
      tx,
      rows,
      () => ({ type: "transfer", categoryCode: null, categoryId: null, categorySource: null }),
      channel,
    );
  }

  /** Прошлые операции контрагента, которые правило изменит: не выбранные вами вручную, другой категории, подходящего вида. */
  async function pastOf(
    s: ScopedDb,
    rows: readonly TransactionRow[],
    category: CategoryRef,
  ): Promise<TransactionRow[]> {
    const result: TransactionRow[] = [];
    for (const row of rows) {
      const same = sameCategory(categoryRefOf(row), category);
      if (
        row.categorySource === "user" ||
        same ||
        categoryKindsOf(row.type as TransactionType).length === 0
      ) {
        continue;
      }
      if (await fits(s, row, category)) result.push(row);
    }
    return result;
  }

  /** «Да» (confirm): применить правило к прошлым операциям контрагента; одним «Отменить». */
  async function confirmApplyRule(tx: ScopedDb, payload: unknown): Promise<string | undefined> {
    const { merchantKey, category, channel } = ApplyPayload.parse(payload);
    const ref = category as CategoryRef;
    const candidates = await listByMerchantKey(tx, merchantKey);
    const locked = await lockMany(
      tx,
      candidates.map((row) => row.id),
    );
    const rows = await pastOf(tx, locked, ref);
    log.info({ count: rows.length }, "transactions.apply-rule");
    return commit(tx, rows, () => columns(ref, "user-rule"), channel);
  }

  return {
    requestChangeCategory,
    requestMarkTransfer,
    confirmChangeCategory,
    confirmMarkTransfer,
    confirmApplyRule,
    pastOf,
    categoryLabel,
  };
}

export type Bulk = ReturnType<typeof makeBulk>;
