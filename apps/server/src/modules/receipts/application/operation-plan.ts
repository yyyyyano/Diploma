// План операции чека (RCPT-09, RCPT-10, RCPT-13): категории позиций (правила, затем модель — вне транзакции), разбивка
// итога по категориям (calc.splitByCategory), категория самой операции — самая крупная часть, гарантийные позиции. Чек
// не в BYN операции не получает: счёт операции в валюте счёта, а «Наличные» и карты без пары — в BYN.
import { splitByCategory } from "@kosht/calc";
import { Money } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { CategoriesFacade } from "../../categories/index.ts";
import type { ReceiptOperation, StoredCategoryRef } from "./ports.ts";
import { hasWarranty } from "../domain/warranty.ts";
import type { ReadReceipt } from "../domain/read-receipt.ts";
import type { PaymentMethod } from "../domain/types.ts";

/** Ключ категории в разбивке: код встроенной или id своей. */
const keyOf = (category: StoredCategoryRef) =>
  category.code !== undefined ? `code:${category.code}` : `id:${category.id}`;
const OTHER: StoredCategoryRef = { code: "other" };

export interface PlannedItem {
  readonly category: StoredCategoryRef;
  readonly warranty: boolean;
}

export interface OperationPlan {
  readonly items: readonly PlannedItem[];
  /** Операция чека; нет — чек не в BYN. */
  readonly operation: Omit<ReceiptOperation, "receiptId" | "needsReview"> | undefined;
  readonly warrantyCount: number;
}

export interface PlanInput {
  readonly read: ReadReceipt;
  readonly currency: string;
  readonly merchant: { readonly name: string | null; readonly key: string | null };
  /** День и время покупки как прочитаны; нет дня — сегодня. */
  readonly date: string;
  readonly time: string | null;
  readonly method: PaymentMethod | null;
  readonly cardLast4: string | null;
}

export function makeOperationPlan(d: {
  readonly categories: Pick<CategoriesFacade, "categorize">;
}) {
  return async function plan(s: ScopedDb, input: PlanInput): Promise<OperationPlan> {
    const { read } = input;
    // RCPT-09: категория каждой позиции — по нормализованному наименованию (правила пользователя, словарь, модель).
    const categorized = await d.categories.categorize(
      s,
      read.items.map((item, index) => ({
        key: String(index + 1),
        kind: "expense" as const,
        item: item.name,
      })),
    );
    const items: PlannedItem[] = categorized.map((found, index) => {
      const category: StoredCategoryRef =
        found.category.type === "system"
          ? { code: found.category.code }
          : { id: found.category.id };
      return {
        category,
        warranty: hasWarranty(category.code ?? null, read.items[index]?.name ?? ""),
      };
    });
    const warrantyCount = items.filter((item) => item.warranty).length;
    if (input.currency !== "BYN") return { items, operation: undefined, warrantyCount };

    const refs = new Map<string, StoredCategoryRef>([[keyOf(OTHER), OTHER]]);
    const sources = new Map<string, string>();
    read.items.forEach((_, index) => {
      const category = items[index]?.category;
      if (category === undefined) return;
      refs.set(keyOf(category), category);
      if (!sources.has(keyOf(category)))
        sources.set(keyOf(category), categorized[index]?.source ?? "fallback");
    });
    const parts = splitByCategory({
      lines: read.items.flatMap((item, index) =>
        item.lineTotal === null || item.lineTotal.minor <= 0
          ? []
          : [{ category: keyOf(items[index]?.category ?? OTHER), total: item.lineTotal }],
      ),
      total: read.total,
      remainderKey: keyOf(OTHER),
    });
    const splits = parts.map((part) => ({
      category: refs.get(part.category) ?? OTHER,
      amount: part.amount.value,
    }));
    // Категория операции — самая крупная часть чека; нераспознанный остаток её не определяет.
    const main = parts
      .filter((part) => !part.remainder)
      .toSorted((a, b) => b.amount.value.minor - a.amount.value.minor)[0];
    const mainKey = main?.category ?? keyOf(OTHER);
    return {
      items,
      warrantyCount,
      operation: {
        method: input.method,
        cardLast4: input.cardLast4,
        occurredOn: input.date,
        occurredTime: input.time,
        amount: Money.of(read.total.minor, input.currency),
        merchantName: input.merchant.name,
        merchantKey: input.merchant.key,
        category: { ...(refs.get(mainKey) ?? OTHER), source: sources.get(mainKey) ?? "fallback" },
        splits,
      },
    };
  };
}

export type PlanOperation = ReturnType<typeof makeOperationPlan>;
