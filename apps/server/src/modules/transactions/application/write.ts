// Ручной ввод и правка операций (TXN-03, AGT-05, STMT-02, STMT-09, P5): всё сразу, с «Отменить» (ревизия «до» в
// пачке, в журнале actions — её batchId). Всё, что ходит наружу — категория правилами, очистка контрагента, курс НБРБ —
// считается до транзакции; в транзакции — запись операции, история, сдвиг остатка счёта и фоновые задачи (откат
// убирает всё вместе). Операция пишется в валюте своего счёта.
import {
  CreateTransactionInput,
  type Transaction,
  type UpdateTransactionInput,
} from "@kosht/contract";
import { Money } from "@kosht/kernel";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import {
  changedFields,
  directionOf,
  toDbTime,
  type Direction,
  type TransactionType,
} from "../domain/transactions.ts";
import {
  findMany,
  insertTransaction,
  lockMany,
  updateTransaction,
  type TransactionRow,
} from "../infrastructure/db/transactions.repo.ts";
import type { ChosenCategory } from "./prepare.ts";
import type { Deps, Origin, Parts } from "./deps.ts";
import { categoryRefOf, snapshotOf, toDto } from "./mapping.ts";

export const RESTORE_HANDLER = "transactions.restore";

type CreateInput = z.output<typeof CreateTransactionInput>;
type UpdateInput = z.output<typeof UpdateTransactionInput>;

/** Направление по типу; у перевода — как выбрали (по умолчанию со счёта); у остальных чужое направление — ошибка. */
function resolveDirection(type: TransactionType, requested: Direction | undefined): Direction {
  const direction = directionOf(type, requested);
  if (type !== "transfer" && requested !== undefined && requested !== direction) {
    throw new AppError("VALIDATION", { reason: "direction" });
  }
  return direction;
}

function categoryColumns(category: ChosenCategory) {
  return {
    categoryCode: category.ref?.type === "system" ? category.ref.code : null,
    categoryId: category.ref?.type === "custom" ? category.ref.id : null,
    categorySource: category.source,
  };
}

export function makeWrite(d: Deps, parts: Parts) {
  const { clock, log, jobs } = d.platform;
  const { prepare, ledger } = parts;

  /** Фоновые догонялки: курс НБРБ, которого не было, и модель для категории, которую правила не покрыли. */
  async function enqueueFollowUps(
    tx: ScopedDb,
    row: TransactionRow,
    pendingModel: boolean,
  ): Promise<void> {
    if (row.amountBynMinor === null && row.currency !== "BYN") {
      await jobs.enqueue(tx, parts.jobs.fillRates, { ids: [row.id] });
    }
    if (pendingModel) await jobs.enqueue(tx, parts.jobs.categorize, { ids: [row.id] });
  }

  async function record(tx: ScopedDb, row: TransactionRow, batchId: string, origin: Origin) {
    return d.actions.record(tx, {
      handler: RESTORE_HANDLER,
      payload: { batchId },
      subject: `transaction:${row.id}`,
      channel: origin.channel,
    });
  }

  /** TXN-03: новая операция; счёт не указан — «Наличные» (BYN); валюта суммы должна быть валютой счёта. */
  async function create(
    s: ScopedDb,
    input: CreateInput,
    origin: Origin,
  ): Promise<{ transaction: Transaction; undoToken: string }> {
    if (input.amount.minor <= 0) throw new AppError("VALIDATION", { reason: "amount" });
    const direction = resolveDirection(input.type, input.direction);
    const currency =
      input.accountId === undefined ? "BYN" : await d.accounts.currencyOf(s, input.accountId);
    if (input.amount.currency !== currency) {
      throw new AppError("VALIDATION", { reason: "currency", currency });
    }
    if (input.type === "transfer" && input.category !== null) {
      throw new AppError("VALIDATION", { reason: "category" });
    }
    const merchant = await prepare.merchant(input.merchant);
    const category =
      input.category !== null
        ? await prepare.chosen(s, input.type, input.category)
        : await prepare.byRules(s, input.type, merchant.text);
    const byn = await prepare.inByn(input.amount, input.occurredOn);
    const batchId = randomUUID();
    const { row, undoToken } = await s.transaction(async (tx) => {
      const accountId = input.accountId ?? (await d.accounts.cash(tx));
      const created = await insertTransaction(tx, {
        accountId,
        type: input.type,
        direction,
        occurredOn: input.occurredOn,
        occurredTime: toDbTime(input.occurredTime),
        amountMinor: input.amount.minor,
        currency,
        amountBynMinor: byn?.amountBynMinor ?? null,
        fxRateId: byn?.fxRateId ?? null,
        description: merchant.text ?? "",
        merchantName: merchant.name,
        merchantKey: merchant.key,
        note: input.note,
        ...categoryColumns(category),
        source: origin.source,
      });
      await ledger.settle(tx, { batchId, channel: origin.channel, changes: [{ after: created }] });
      const token = await record(tx, created, batchId, origin);
      await enqueueFollowUps(tx, created, category.pendingModel);
      return { row: created, undoToken: token };
    });
    log.info({ transactionId: row.id }, "transactions.created");
    return { transaction: toDto(row), undoToken };
  }

  /**
   * TXN-03: правка указанных полей. Версия, которую человек видел, не совпала — CONFLICT (не затираем чужую правку);
   * сумма, день или счёт сменились — эквивалент в BYN считается заново; тип сменился — категория остаётся, если
   * подходит, иначе подбирается заново.
   */
  async function update(
    s: ScopedDb,
    input: UpdateInput,
    origin: Origin,
  ): Promise<{ transaction: Transaction; undoToken: string }> {
    const [row] = await findMany(s, [input.id]);
    if (row === undefined) throw new AppError("NOT_FOUND");
    if (input.expectedVersion !== undefined && input.expectedVersion !== row.version) {
      throw new AppError("CONFLICT");
    }
    const p = input.patch;
    const type = p.type ?? (row.type as TransactionType);
    const direction = resolveDirection(
      type,
      p.direction ?? (type === "transfer" ? (row.direction as Direction) : undefined),
    );
    const accountId = p.accountId ?? row.accountId;
    const currency =
      p.accountId === undefined ? row.currency : await d.accounts.currencyOf(s, accountId);
    const amount = p.amount ?? Money.of(row.amountMinor, row.currency);
    if (amount.minor <= 0) throw new AppError("VALIDATION", { reason: "amount" });
    if (amount.currency !== currency) {
      throw new AppError("VALIDATION", { reason: "currency", currency });
    }
    const occurredOn = p.occurredOn ?? row.occurredOn;
    const occurredTime = p.occurredTime === undefined ? row.occurredTime : toDbTime(p.occurredTime);
    const merchant =
      p.merchant === undefined
        ? { name: row.merchantName, key: row.merchantKey, text: row.description }
        : await prepare.merchant(p.merchant);

    let category: ChosenCategory;
    if (type === "transfer") {
      if (p.category !== undefined && p.category !== null) {
        throw new AppError("VALIDATION", { reason: "category" });
      }
      category = { ref: null, source: null, pendingModel: false };
    } else if (p.category !== undefined) {
      if (p.category === null) throw new AppError("VALIDATION", { reason: "category" });
      category = await prepare.chosen(s, type, p.category);
    } else {
      const current = categoryRefOf(row);
      const keeps =
        current !== null && (p.type === undefined || (await prepare.accepts(s, type, current)));
      category = keeps
        ? {
            ref: current,
            source: row.categorySource as ChosenCategory["source"],
            pendingModel: false,
          }
        : await prepare.byRules(s, type, merchant.text ?? row.description);
    }

    const rateAffected =
      p.amount !== undefined ||
      p.occurredOn !== undefined ||
      p.accountId !== undefined ||
      (row.amountBynMinor === null && row.currency !== "BYN");
    const byn = rateAffected
      ? await prepare.inByn(amount, occurredOn)
      : { amountBynMinor: row.amountBynMinor, fxRateId: row.fxRateId };

    const next = {
      accountId,
      type,
      direction,
      occurredOn,
      occurredTime,
      amountMinor: amount.minor,
      currency,
      amountBynMinor: byn?.amountBynMinor ?? null,
      fxRateId: byn?.fxRateId ?? null,
      merchantName: merchant.name,
      merchantKey: merchant.key,
      note: p.note === undefined ? row.note : p.note,
      ...categoryColumns(category),
    };
    const batchId = randomUUID();
    const result = await s.transaction(async (tx) => {
      const [locked] = await lockMany(tx, [row.id]);
      if (locked === undefined) throw new AppError("NOT_FOUND");
      if (locked.version !== row.version) throw new AppError("CONFLICT");
      await updateTransaction(tx, row.id, {
        ...next,
        version: row.version + 1,
        updatedAt: clock.now(),
      });
      const [after] = await findMany(tx, [row.id]);
      if (after === undefined) throw new Error("transactions: операция пропала после правки.");
      if (changedFields(snapshotOf(locked), snapshotOf(after)).length === 0) {
        throw new AppError("VALIDATION", { reason: "nothing-changed" });
      }
      await ledger.settle(tx, {
        batchId,
        channel: origin.channel,
        changes: [{ before: locked, after }],
      });
      const token = await record(tx, after, batchId, origin);
      await enqueueFollowUps(tx, after, category.pendingModel);
      return { row: after, undoToken: token };
    });
    log.info({ transactionId: row.id }, "transactions.updated");
    return { transaction: toDto(result.row), undoToken: result.undoToken };
  }

  return { create, update };
}
