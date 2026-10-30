// RCPT-05, RCPT-06: арифметический валидатор чека. Модель только читает цифры с фото, а сходятся они или нет — решает
// код (P1): для строки «количество × цена − скидка = сумма строки», для чека «сумма строк − скидки на чек = итог»,
// оба с допуском на округление кассы (по умолчанию 0,01 BYN — настройка модуля). Каждое расхождение — расчёт с трассой:
// сайт покажет «Откуда эта цифра?», а перепроверка получит точное описание ошибки.
import { Money } from "@kosht/kernel";
import { node, type Calc } from "../calc.ts";
import { mulQuantity, sub, sum, type NonEmpty } from "../money-ops.ts";

export interface ReceiptLineInput {
  /** Количество в тысячных долях единицы: 3 шт → 3000, 0,345 кг → 345. */
  readonly quantityMilli: number;
  /** Цена за единицу. */
  readonly unitPrice: Money;
  /** Скидка на строку, не меньше нуля. */
  readonly discount: Money;
  /** Сумма строки, как напечатана на чеке. */
  readonly lineTotal: Money;
}

export interface ReceiptInput {
  /** Строки в порядке чека: номер строки в ответе — позиция в этом списке с единицы. */
  readonly lines: readonly ReceiptLineInput[];
  /** Скидки на весь чек, не меньше нуля. */
  readonly receiptDiscount: Money;
  /** Итог, как напечатан на чеке. */
  readonly total: Money;
  /** Допуск на округление: разница не больше допуска — сходится (RCPT-05: 0,01 BYN по умолчанию). */
  readonly tolerance: Money;
}

export interface LineValidation {
  /** Номер строки на чеке с единицы — так её называет человек («строка 2»). */
  readonly line: number;
  readonly ok: boolean;
  /** Сумма строки по формуле: количество × цена − скидка. */
  readonly expected: Calc<Money>;
  /** Напечатанная сумма минус расчётная: положительная — на чеке больше, чем получается. */
  readonly difference: Calc<Money>;
}

export interface TotalValidation {
  readonly ok: boolean;
  /** Сумма напечатанных сумм строк. */
  readonly linesSum: Calc<Money>;
  /** Итог по формуле: сумма строк − скидки на чек. */
  readonly expected: Calc<Money>;
  /** Напечатанный итог минус расчётный. */
  readonly difference: Calc<Money>;
}

export interface ReceiptValidation {
  /** Сходятся все строки и итог. */
  readonly ok: boolean;
  readonly lines: readonly LineValidation[];
  readonly total: TotalValidation;
  /** Номера спорных строк (с единицы) по порядку чека. */
  readonly disputedLines: readonly number[];
}

const ROUNDING = { rounding: "half-up-kopeck" } as const;

const within = (difference: Money, tolerance: Money): boolean =>
  Math.abs(difference.minor) <= tolerance.minor;

function validateLine(input: ReceiptLineInput, line: number, tolerance: Money): LineValidation {
  const gross = mulQuantity(
    "receipts.lineGross",
    node("receipts.unitPrice", input.unitPrice),
    node("receipts.quantity", input.quantityMilli),
    ROUNDING,
  );
  const expected = sub("receipts.lineExpected", gross, [
    node("receipts.lineDiscount", input.discount),
  ]);
  const difference = sub("receipts.lineDifference", node("receipts.lineTotal", input.lineTotal), [
    expected,
  ]);
  return { line, ok: within(difference.value, tolerance), expected, difference };
}

function validateTotal(input: ReceiptInput): TotalValidation {
  const lineNodes = input.lines.map((line) => node("receipts.lineTotal", line.lineTotal));
  const [first, ...rest] = lineNodes;
  const linesSum =
    first === undefined
      ? node("receipts.linesSum", Money.of(0, input.total.currency))
      : sum("receipts.linesSum", [first, ...rest] as NonEmpty<Calc<Money>>);
  const expected = sub("receipts.expectedTotal", linesSum, [
    node("receipts.receiptDiscount", input.receiptDiscount),
  ]);
  const difference = sub("receipts.totalDifference", node("receipts.total", input.total), [
    expected,
  ]);
  return { ok: within(difference.value, input.tolerance), linesSum, expected, difference };
}

/**
 * RCPT-05: проверить арифметику чека. Расхождение — не ошибка программы, а результат: строка или итог названы, разница
 * посчитана. Деньги разных валют и дробное количество — ошибка программы.
 */
export function validateReceipt(input: ReceiptInput): ReceiptValidation {
  const lines = input.lines.map((line, index) => validateLine(line, index + 1, input.tolerance));
  const total = validateTotal(input);
  return {
    ok: total.ok && lines.every((line) => line.ok),
    lines,
    total,
    disputedLines: lines.filter((line) => !line.ok).map((line) => line.line),
  };
}
