// «Отменить» (P5, TXN-03): возвращает операции пачки действия такими, какими они были до него, — созданную удаляет,
// изменённую возвращает к состоянию «до», удалённую воссоздаёт с тем же id и датой записи. Если операцию после
// действия уже правили (версия не та) — CONFLICT: «Отменить» не затирает более позднюю правку. Остатки счетов
// сдвигаются обратно тем же учётом, что и само действие.
import { CategoryId, SystemCategoryCode } from "@kosht/contract";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { StoredState } from "../domain/transactions.ts";
import {
  deleteTransactions,
  existingIds,
  insertTransaction,
  listBatch,
  lockMany,
  updateTransaction,
} from "../infrastructure/db/transactions.repo.ts";
import type { Change } from "./ledger.ts";
import type { Rule } from "./rule.ts";
import type { Deps, Parts } from "./deps.ts";

/** Нагрузка журнала: пачка ревизий и, если исправление создало правило контрагента, как его вернуть (CAT-05). */
const Payload = z.object({
  batchId: z.string().min(1),
  rule: z
    .object({
      pattern: z.string().min(1),
      previous: z
        .discriminatedUnion("type", [
          z.object({ type: z.literal("system"), code: SystemCategoryCode }),
          z.object({ type: z.literal("custom"), id: CategoryId }),
        ])
        .nullable(),
    })
    .optional(),
});

export function makeRestore(d: Deps, parts: Parts, rule: Rule) {
  /** Поля состояния «до» для UPDATE (то, что правится пользователем и системой). */
  function columns(state: StoredState) {
    return {
      accountId: state.accountId,
      type: state.type,
      direction: state.direction,
      occurredOn: state.occurredOn,
      occurredTime: state.occurredTime,
      amountMinor: state.amountMinor,
      currency: state.currency,
      amountBynMinor: state.amountBynMinor,
      fxRateId: state.fxRateId,
      merchantName: state.merchantName,
      merchantKey: state.merchantKey,
      note: state.note,
      categoryCode: state.categoryCode,
      categoryId: state.categoryId,
      categorySource: state.categorySource,
    };
  }

  async function restore(tx: ScopedDb, payload: unknown): Promise<void> {
    const parsed = Payload.safeParse(payload);
    if (!parsed.success) throw new Error("transactions.restore: нет batchId в журнале.");
    const { batchId, rule: undoRule } = parsed.data;
    const revisions = await listBatch(tx, batchId);
    if (revisions.length === 0) throw new Error("transactions.restore: пачки нет в истории.");
    const current = new Map(
      (await lockMany(tx, [...new Set(revisions.map((r) => r.transactionId))])).map((row) => [
        row.id,
        row,
      ]),
    );
    const channel = revisions[0]?.channel === "telegram" ? "telegram" : "web";
    const changes: Change[] = [];
    const toDelete: string[] = [];
    const refs = new Set<string>();
    for (const revision of revisions) {
      const state = revision.before as StoredState | null;
      for (const ref of [state?.transferPairId, state?.refundOfId]) {
        if (ref !== null && ref !== undefined) refs.add(ref);
      }
    }
    const alive = await existingIds(tx, [...refs]);
    for (const revision of revisions) {
      const row = current.get(revision.transactionId);
      const state = revision.before as StoredState | null;
      if (revision.action === "deleted") {
        // Воссоздать удалённую; уже есть (вернули иначе) — ничего.
        if (row !== undefined || state === null) continue;
        const created = await insertTransaction(tx, {
          id: revision.transactionId,
          createdAt: new Date(state.createdAt),
          ...columns(state),
          description: state.description,
          source: state.source,
          visibility: state.visibility,
          transferPairId:
            state.transferPairId !== null && alive.has(state.transferPairId)
              ? state.transferPairId
              : null,
          refundOfId:
            state.refundOfId !== null && alive.has(state.refundOfId) ? state.refundOfId : null,
          version: state.version + 1,
        });
        changes.push({ after: created });
        continue;
      }
      // created / updated: операцию после действия правили или удалили — отмена её не трогает.
      if (row === undefined) {
        if (revision.action === "created") continue;
        throw new AppError("CONFLICT");
      }
      if (row.version !== revision.versionAfter) throw new AppError("CONFLICT");
      if (revision.action === "created") {
        toDelete.push(row.id);
        changes.push({ before: row });
        continue;
      }
      if (state === null) throw new Error("transactions.restore: у правки нет состояния «до».");
      await updateTransaction(tx, row.id, {
        ...columns(state),
        version: row.version + 1,
        updatedAt: d.platform.clock.now(),
      });
      const [after] = await lockMany(tx, [row.id]);
      if (after === undefined) throw new Error("transactions.restore: операция пропала.");
      changes.push({ before: row, after });
    }
    await deleteTransactions(tx, toDelete);
    await parts.ledger.settle(tx, {
      batchId: randomUUID(),
      channel,
      restoring: true,
      changes,
    });
    // CAT-05: исправление отменено — правило контрагента такое, каким было до него.
    if (undoRule !== undefined) await rule.revert(tx, undoRule);
    // Курс, которого не было в состоянии «до», досчитает фон (как после обычного ввода).
    const missing = changes.flatMap((c) =>
      c.after !== undefined && c.after.amountBynMinor === null && c.after.currency !== "BYN"
        ? [c.after.id]
        : [],
    );
    if (missing.length > 0)
      await d.platform.jobs.enqueue(tx, parts.jobs.fillRates, { ids: missing });
    d.platform.log.info({ count: changes.length }, "transactions.restored");
  }

  return { restore };
}
