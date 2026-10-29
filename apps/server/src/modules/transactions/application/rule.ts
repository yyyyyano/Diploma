// Правило из исправления (CAT-05, AGT-07): ручная смена категории у операции с известным контрагентом запоминается
// правилом «этот контрагент — эта категория» (по очищенному названию, ключу merchants) и спрашивает «Применить к N
// прошлым операциям?» — ожидающее решение; «Да» меняет прошлые одной пачкой с «Отменить». Правило создаётся в
// транзакции исправления и откатывается его «Отменить»: прежнее правило возвращается, отсутствовавшее — снимается.
import type { ApplyToPast, CategoryRef } from "@kosht/contract";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { listByMerchantKey, type TransactionRow } from "../infrastructure/db/transactions.repo.ts";
import type { Bulk } from "./bulk.ts";
import type { Deps } from "./deps.ts";
import { APPLY_RULE_HANDLER } from "./handlers.ts";

/** Что вернуть правилу при «Отменить»: шаблон и прежняя категория (нет — правила не было). */
export interface UndoRule {
  readonly pattern: string;
  readonly previous: CategoryRef | null;
}

export interface Learned {
  readonly undoRule: UndoRule | null;
  readonly applyToPast: ApplyToPast | null;
}

export function makeRule(d: Deps, bulk: Bulk) {
  /**
   * Запомнить исправление правилом и предложить применить его к прошлым. Нет ключа контрагента (операция без названия)
   * — правила нет. Прошлых, которых правило изменит, нет — вопроса нет.
   */
  async function learn(
    tx: ScopedDb,
    after: TransactionRow,
    category: CategoryRef,
    channel: "web" | "telegram",
  ): Promise<Learned> {
    const key = after.merchantKey;
    if (key === null) return { undoRule: null, applyToPast: null };
    const previous =
      (await d.categories.userRule(tx, { matcher: "merchant", pattern: key })) ?? null;
    await d.categories.setUserRule(tx, { matcher: "merchant", pattern: key, category });
    const undoRule = { pattern: key, previous };
    const past = await bulk.pastOf(tx, await listByMerchantKey(tx, key), category);
    if (past.length === 0) return { undoRule, applyToPast: null };
    const decisionId = await d.actions.propose(tx, {
      handler: APPLY_RULE_HANDLER,
      payload: { merchantKey: key, category, channel },
      summary: {
        key: "decisions.transactionsApplyRule",
        params: {
          count: past.length,
          merchant: after.merchantName ?? key,
          category: await bulk.categoryLabel(tx, category),
        },
      },
    });
    return { undoRule, applyToPast: { decisionId, count: past.length } };
  }

  /** «Отменить» исправления: правило контрагента — как было до него. */
  async function revert(tx: ScopedDb, undo: UndoRule): Promise<void> {
    if (undo.previous === null) {
      await d.categories.removeUserRule(tx, { matcher: "merchant", pattern: undo.pattern });
    } else {
      await d.categories.setUserRule(tx, {
        matcher: "merchant",
        pattern: undo.pattern,
        category: undo.previous,
      });
    }
  }

  return { learn, revert };
}

export type Rule = ReturnType<typeof makeRule>;
