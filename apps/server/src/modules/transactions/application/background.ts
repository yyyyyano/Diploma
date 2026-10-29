// Фон worker (STMT-09, CAT-06): досчитать эквивалент в BYN, когда НБРБ был недоступен при вводе, и подобрать категорию
// моделью там, где правила не покрыли. Обе задачи — не пользовательские правки: версия операции не растёт (человек,
// который в это время правит операцию, не получит ложный CONFLICT), в истории — запись канала «system», сигнал
// сайту — transactions.changed. Курс и модель — вне транзакции (HTTP и шлюз внутри неё запрещены).
import { Money } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { kindForRules, type TransactionType } from "../domain/transactions.ts";
import { findMany, lockMany, updateTransaction } from "../infrastructure/db/transactions.repo.ts";
import type { Deps, Parts } from "./deps.ts";
import { randomUUID } from "node:crypto";

export function makeBackground(d: Deps, parts: Pick<Parts, "prepare" | "ledger">) {
  const { clock, log } = d.platform;

  /**
   * STMT-09: эквивалент в BYN для операций в валюте, у которых его не было. Часть курсов не нашлась — остальным
   * проставляем, а задача падает UNAVAILABLE (повторяемая): очередь повторит позже, когда НБРБ ответит.
   */
  async function fillRates(s: ScopedDb, ids: readonly string[]): Promise<void> {
    const rows = (await findMany(s, ids)).filter(
      (row) => row.amountBynMinor === null && row.currency !== "BYN",
    );
    if (rows.length === 0) return;
    const found = new Map<string, { amountBynMinor: number; fxRateId: string | null }>();
    for (const row of rows) {
      const byn = await parts.prepare.inByn(
        Money.of(row.amountMinor, row.currency),
        row.occurredOn,
      );
      if (byn !== null) found.set(row.id, byn);
    }
    if (found.size > 0) {
      await s.transaction(async (tx) => {
        const locked = (await lockMany(tx, [...found.keys()])).filter(
          (row) => row.amountBynMinor === null,
        );
        const changes = [];
        for (const row of locked) {
          const byn = found.get(row.id);
          if (byn === undefined) continue;
          await updateTransaction(tx, row.id, { ...byn, updatedAt: clock.now() });
          changes.push({ before: row, after: { ...row, ...byn } });
        }
        if (changes.length > 0) {
          await parts.ledger.settle(tx, { batchId: randomUUID(), channel: "system", changes });
        }
      });
      log.info({ count: found.size }, "transactions.rates-filled");
    }
    if (found.size < rows.length) throw new AppError("UNAVAILABLE");
  }

  /** CAT-06: модель для операций с категорией «по умолчанию» (fallback); то, что человек успел выбрать сам, не трогаем. */
  async function categorizeFallback(s: ScopedDb, ids: readonly string[]): Promise<void> {
    const rows = (await findMany(s, ids)).filter(
      (row) => row.categorySource === "fallback" && row.type !== "transfer",
    );
    if (rows.length === 0) return;
    const results = await d.categories.categorize(
      s,
      rows.map((row) => ({
        key: row.id,
        kind: kindForRules(row.type as TransactionType),
        description: row.merchantName ?? row.description,
      })),
    );
    const byId = new Map(results.map((result) => [result.key, result]));
    await s.transaction(async (tx) => {
      const locked = (
        await lockMany(
          tx,
          rows.map((row) => row.id),
        )
      ).filter((row) => row.categorySource === "fallback");
      const changes = [];
      for (const row of locked) {
        const result = byId.get(row.id);
        if (result === undefined || result.source === "fallback") continue;
        const next = {
          categoryCode: result.category.type === "system" ? result.category.code : null,
          categoryId: result.category.type === "custom" ? result.category.id : null,
          categorySource: result.source,
        };
        await updateTransaction(tx, row.id, { ...next, updatedAt: clock.now() });
        changes.push({ before: row, after: { ...row, ...next } });
      }
      if (changes.length > 0) {
        await parts.ledger.settle(tx, { batchId: randomUUID(), channel: "system", changes });
      }
    });
  }

  return { fillRates, categorizeFallback };
}

export type Background = ReturnType<typeof makeBackground>;
