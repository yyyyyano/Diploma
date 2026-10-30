// RCPT-06: ответ перепроверки вливается в чек только в названные спорные места. Что модель вернула сверх спрошенного
// (чужие строки, итог, о котором не просили), отбрасывается: перепроверка не переписывает чек целиком и не может
// «подогнать» сошедшиеся строки. Наименования не меняются никогда — перепроверяют числа.
import type { Mismatch, PrintedItem, PrintedReceipt } from "./types.ts";

export interface RecheckAnswer {
  readonly lines: readonly {
    readonly line: number;
    readonly quantity: string;
    readonly unitPrice: string;
    readonly discount: string | null;
    readonly lineTotal: string;
  }[];
  readonly total: string | null;
  readonly receiptDiscount: string | null;
}

/** Что спрашивали: номера спорных строк и спорен ли итог (итог и скидки на чек перечитываются вместе). */
export interface Asked {
  readonly lines: readonly number[];
  readonly total: boolean;
}

export function askedOf(mismatches: readonly Mismatch[]): Asked {
  const lines = mismatches.flatMap((mismatch) => (mismatch.kind === "line" ? [mismatch.line] : []));
  return {
    lines: [...new Set(lines)].toSorted((a, b) => a - b),
    total: mismatches.some((mismatch) => mismatch.kind === "total"),
  };
}

const same = (a: PrintedItem, b: PrintedItem) =>
  a.quantity === b.quantity &&
  a.unitPrice === b.unitPrice &&
  a.discount === b.discount &&
  a.lineTotal === b.lineTotal;

export function applyRecheck(
  printed: PrintedReceipt,
  answer: RecheckAnswer,
  asked: Asked,
): { readonly printed: PrintedReceipt; readonly changedLines: readonly number[] } {
  const items = [...printed.items];
  const changed: number[] = [];
  for (const line of answer.lines) {
    const current = items[line.line - 1];
    if (current === undefined || !asked.lines.includes(line.line)) continue;
    const next: PrintedItem = {
      ...current,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      lineTotal: line.lineTotal,
    };
    if (!same(current, next)) changed.push(line.line);
    items[line.line - 1] = next;
  }
  return {
    printed: {
      items,
      total: asked.total && answer.total !== null ? answer.total : printed.total,
      receiptDiscount:
        asked.total && answer.total !== null ? answer.receiptDiscount : printed.receiptDiscount,
    },
    changedLines: changed.toSorted((a, b) => a - b),
  };
}
