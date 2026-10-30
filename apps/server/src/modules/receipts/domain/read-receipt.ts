// RCPT-05, RCPT-06: напечатанный чек → числа → проверка арифметики → расхождения. Модель только переписывает цифры,
// сходятся ли они, решает `validateReceipt` из calc (P1). Нечитаемое число (не разобралось из текста) — тоже спорное
// место: строка уходит на перепроверку наравне с арифметической ошибкой, а в проверку подставляется нейтральное
// значение, чтобы остальная арифметика всё равно посчиталась.
import { validateReceipt, type ReceiptLineInput, type ReceiptValidation } from "@kosht/calc";
import { Money } from "@kosht/kernel";
import { parsePrintedMoney, parsePrintedQuantity, plainMoney, plainQuantity } from "./printed.ts";
import type { Mismatch, PrintedReceipt, ReadItem } from "./types.ts";

export interface ReadReceipt {
  readonly items: readonly ReadItem[];
  readonly receiptDiscount: Money;
  /** Итог чека; не разобрался — сумма строк за вычетом скидок (расхождения нет, но есть пометка «нечитаемый»). */
  readonly total: Money;
  readonly validation: ReceiptValidation;
  readonly mismatches: readonly Mismatch[];
  /** Сходится: строки и итог проверены и нечитаемых чисел нет. */
  readonly ok: boolean;
}

/** Строки как числа; скидка не напечатана — ноль, скидка с минусом — по модулю (на чеке её часто печатают со знаком). */
export function readItems(printed: PrintedReceipt, currency: string): ReadItem[] {
  return printed.items.map((item) => {
    const discount =
      item.discount === null ? undefined : parsePrintedMoney(item.discount, currency);
    return {
      name: item.name,
      unit: item.unit,
      quantityMilli: parsePrintedQuantity(item.quantity) ?? null,
      unitPrice: parsePrintedMoney(item.unitPrice, currency) ?? null,
      discount:
        discount === undefined
          ? Money.of(0, currency)
          : Money.of(Math.abs(discount.minor), currency),
      lineTotal: parsePrintedMoney(item.lineTotal, currency) ?? null,
    };
  });
}

/** Вход валидатора для строки: нечитаемое число заменяется так, чтобы строка не давала ложной арифметической ошибки. */
function toLineInput(item: ReadItem, currency: string): ReceiptLineInput {
  const zero = Money.of(0, currency);
  const lineTotal = item.lineTotal ?? zero;
  if (item.quantityMilli === null || item.unitPrice === null) {
    // Количество или цена не прочитались: расчётная сумма = напечатанной (1 × сумма строки − скидка).
    return {
      quantityMilli: 1000,
      unitPrice: Money.of(lineTotal.minor + item.discount.minor, currency),
      discount: item.discount,
      lineTotal,
    };
  }
  return {
    quantityMilli: item.quantityMilli,
    unitPrice: item.unitPrice,
    discount: item.discount,
    lineTotal: item.lineTotal ?? zero,
  };
}

export interface ReadOptions {
  readonly currency: string;
  /** Допуск на округление, копейки (настройка `receipts.tolerance-minor`). */
  readonly toleranceMinor: number;
}

export function readReceipt(
  printed: PrintedReceipt,
  items: readonly ReadItem[],
  options: ReadOptions,
): ReadReceipt {
  const { currency } = options;
  const discount =
    printed.receiptDiscount === null
      ? undefined
      : parsePrintedMoney(printed.receiptDiscount, currency);
  const receiptDiscount = Money.of(Math.abs(discount?.minor ?? 0), currency);
  const printedTotal = parsePrintedMoney(printed.total, currency);
  const lineInputs = items.map((item) => toLineInput(item, currency));
  // Нечитаемый итог: подставляем расчётный, чтобы арифметика итога не ругалась ложно.
  const linesSum = lineInputs.reduce((acc, line) => acc + line.lineTotal.minor, 0);
  const total = printedTotal ?? Money.of(linesSum - receiptDiscount.minor, currency);
  const validation = validateReceipt({
    lines: lineInputs,
    receiptDiscount,
    total,
    tolerance: Money.of(options.toleranceMinor, currency),
  });
  const mismatches: Mismatch[] = [];
  items.forEach((item, index) => {
    const line = index + 1;
    const checked = validation.lines[index];
    if (item.quantityMilli === null || item.unitPrice === null || item.lineTotal === null) {
      mismatches.push({ kind: "line", line, reason: "unreadable" });
    } else if (checked !== undefined && !checked.ok) {
      mismatches.push({
        kind: "line",
        line,
        reason: "arithmetic",
        expectedMinor: checked.expected.value.minor,
        printedMinor: item.lineTotal.minor,
      });
    }
  });
  if (printedTotal === undefined) {
    mismatches.push({ kind: "total", reason: "unreadable" });
  } else if (
    !validation.total.ok &&
    !mismatches.some((mismatch) => mismatch.kind === "line" && mismatch.reason === "unreadable")
  ) {
    // Пока в какой-то строке число не разобрано, сумма строк неполна: расхождение итога ложное, модели его не называем.
    // Разница при этом остаётся в validation и становится «нераспознанным остатком» чека (RCPT-07).
    mismatches.push({
      kind: "total",
      reason: "arithmetic",
      expectedMinor: validation.total.expected.value.minor,
      printedMinor: printedTotal.minor,
    });
  }
  return {
    items,
    receiptDiscount,
    total,
    validation,
    mismatches,
    ok: mismatches.length === 0,
  };
}

/**
 * Описание расхождений для перепроверки (RCPT-06): «строка 2: 3 × 2,49 − скидка 0,00 = 7,47, а на чеке 8,47». Только
 * цифры и фиксированные слова — наименования с чека сюда не попадают: это данные, которым нельзя доверять
 * инструкции (SEC-11).
 */
export function describeMismatches(read: ReadReceipt): string[] {
  return read.mismatches.map((mismatch) => {
    if (mismatch.kind === "total") {
      if (mismatch.reason === "unreadable") return "итог: число не удалось разобрать";
      return `итог: сумма строк − скидки на чек = ${plainMoney(mismatch.expectedMinor)}, а на чеке ${plainMoney(mismatch.printedMinor)}`;
    }
    if (mismatch.reason === "unreadable") {
      return `строка ${mismatch.line}: количество, цена или сумма не разобраны как числа`;
    }
    const item = read.items[mismatch.line - 1];
    const quantity =
      item?.quantityMilli === null || item === undefined
        ? ""
        : plainQuantity(item.quantityMilli ?? 0);
    const price =
      item?.unitPrice === null || item === undefined ? "" : plainMoney(item.unitPrice?.minor ?? 0);
    const discount = plainMoney(item?.discount.minor ?? 0);
    return `строка ${mismatch.line}: ${quantity} × ${price} − скидка ${discount} = ${plainMoney(mismatch.expectedMinor)}, а на чеке ${plainMoney(mismatch.printedMinor)}`;
  });
}
