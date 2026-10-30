// Модель синтетического чека: из задания (позиции, скидки, оплата) строится то, что напечатано, и эталон. Арифметика
// здесь своя, независимая от calc: проверяемая система не должна подтверждать сама себя. Опечатка кассира — явное
// переопределение напечатанной суммы строки или итога, и эталон называет спорную строку.
import type { Product, Shop } from "./shops.ts";

export interface LineSpec {
  readonly product: Product;
  /** Количество в тысячных долях единицы: 3 шт → 3000, 0,345 кг → 345. */
  readonly quantityMilli: number;
  readonly discountMinor?: number;
  /** Опечатка: напечатанная сумма строки вместо расчётной. */
  readonly printedTotalMinor?: number;
}

export interface ReceiptSpec {
  readonly shop: Shop;
  /** ISO-день и время «чч:мм:сс». */
  readonly date: string;
  readonly time: string;
  readonly number: number;
  readonly lines: readonly LineSpec[];
  readonly receiptDiscountMinor?: number;
  /** Опечатка: напечатанный итог вместо расчётного. */
  readonly printedTotalMinor?: number;
  readonly payment:
    | { readonly method: "cash" }
    | { readonly method: "card"; readonly last4: string };
  /** УИ чека: 24 символа. */
  readonly uid: string;
}

export interface PrintedLine {
  readonly name: string;
  readonly quantity: string;
  readonly unit: string;
  readonly unitPrice: string;
  readonly discount: string | null;
  readonly lineTotal: string;
  readonly normalizedName: string;
}

/** Копейки как на чеке: «2,49», «1 234,50» не бывает — в чеке разрядов нет. */
export function money(minor: number): string {
  const abs = Math.abs(minor);
  return `${minor < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

export function quantity(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const fraction = String(milli % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole},${fraction}`;
}

/** Цена × количество до копейки, половина от нуля (как у кассы). */
function gross(priceMinor: number, quantityMilli: number): number {
  return Math.round((priceMinor * quantityMilli) / 1000);
}

export interface PrintedReceipt {
  readonly lines: readonly PrintedLine[];
  readonly receiptDiscount: string | null;
  readonly total: string;
  /** Эталон арифметики: что должен найти валидатор, если читать чек без ошибок. */
  readonly arithmetic: {
    readonly ok: boolean;
    readonly disputedLines: readonly number[];
    readonly totalOk: boolean;
    readonly linesSumMinor: number;
    readonly expectedTotalMinor: number;
    readonly printedTotalMinor: number;
  };
}

export function printReceipt(spec: ReceiptSpec): PrintedReceipt {
  const lines = spec.lines.map((line) => {
    const discount = line.discountMinor ?? 0;
    const exact = gross(line.product.priceMinor, line.quantityMilli) - discount;
    const printed = line.printedTotalMinor ?? exact;
    return { line, exact, printed, discount };
  });
  const linesSum = lines.reduce((acc, item) => acc + item.printed, 0);
  const receiptDiscount = spec.receiptDiscountMinor ?? 0;
  const expectedTotal = linesSum - receiptDiscount;
  const printedTotal = spec.printedTotalMinor ?? expectedTotal;
  const disputed = lines
    .map((item, index) => (Math.abs(item.printed - item.exact) > 1 ? index + 1 : 0))
    .filter((index) => index > 0);
  const totalOk = Math.abs(printedTotal - expectedTotal) <= 1;
  return {
    lines: lines.map(({ line, printed, discount }) => ({
      name: line.product.name,
      quantity: quantity(line.quantityMilli),
      unit: line.product.unit,
      unitPrice: money(line.product.priceMinor),
      discount: discount === 0 ? null : money(-discount),
      lineTotal: money(printed),
      normalizedName: line.product.normalized,
    })),
    receiptDiscount: receiptDiscount === 0 ? null : money(-receiptDiscount),
    total: money(printedTotal),
    arithmetic: {
      ok: disputed.length === 0 && totalOk,
      disputedLines: disputed,
      totalOk,
      linesSumMinor: linesSum,
      expectedTotalMinor: expectedTotal,
      printedTotalMinor: printedTotal,
    },
  };
}
