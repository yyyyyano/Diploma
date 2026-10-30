// RCPT-09, TXN-10: разбивка суммы чека по категориям позиций. Операция чека равна итогу, а позиции дают суммы по
// категориям: если сумма строк больше итога (скидка на чек, расхождение итога вниз), разница делится между категориями
// пропорционально их суммам, целыми копейками (метод наибольшего остатка: сумма частей ровно равна итогу); если меньше
// (часть чека не распознана) — недостающее уходит в «нераспознанный остаток» (RCPT-07, категория «Прочее»).
import type { Money } from "@kosht/kernel";
import { node, type Calc } from "../calc.ts";
import { sub, sum } from "../money-ops.ts";

export interface SplitLine {
  /** Ключ категории (код встроенной или id своей) — как его выбрал вызывающий. */
  readonly category: string;
  /** Сумма строки чека, как она напечатана (после скидки на строку). */
  readonly total: Money;
}

export interface CategorySplit {
  readonly category: string;
  readonly amount: Calc<Money>;
  /** Нераспознанный остаток чека: вызывающий кладёт его в «Прочее» (RCPT-07). */
  readonly remainder: boolean;
}

/** Делит `amount` по весам целыми, сумма долей равна `amount`; остатки — наибольшим дробным остаткам, при равных — раньше. */
export function allocate(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((acc, weight) => acc + BigInt(weight), 0n);
  if (total === 0n) return weights.map(() => 0);
  const big = BigInt(amount);
  const floors = weights.map((weight) => (big * BigInt(weight)) / total);
  const fractions = weights.map((weight, index) => ({
    index,
    rest: (big * BigInt(weight)) % total,
  }));
  let left = Number(big - floors.reduce((acc, part) => acc + part, 0n));
  const shares = floors.map((part) => Number(part));
  for (const { index } of fractions.toSorted((a, b) =>
    a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1,
  )) {
    if (left === 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    left -= 1;
  }
  return shares;
}

/**
 * Части итога по категориям в порядке первого появления категории в чеке; части с нулевой суммой не возвращаются.
 * `total` — итог чека (больше нуля), `remainderKey` — категория остатка («Прочее»).
 */
export function splitByCategory(input: {
  readonly lines: readonly SplitLine[];
  readonly total: Money;
  readonly remainderKey: string;
}): CategorySplit[] {
  // Группа появляется вместе с первой строкой категории, поэтому пустой не бывает (это видно и по типу).
  const groups = new Map<string, [Calc<Money>, ...Calc<Money>[]]>();
  for (const line of input.lines) {
    const total = node("receipts.lineTotal", line.total);
    const bucket = groups.get(line.category);
    if (bucket === undefined) groups.set(line.category, [total]);
    else bucket.push(total);
  }
  // Map хранит порядок вставки — категории идут в порядке первого появления в чеке.
  const order = [...groups.keys()];
  const sums = [...groups.values()].map((bucket) => sum("receipts.categorySum", bucket));
  const linesSum = sums.reduce((acc, part) => acc + part.value.minor, 0);
  const result: CategorySplit[] = [];
  if (linesSum >= input.total.minor) {
    // Скидка на чек и расхождение итога вниз: делим разницу пропорционально суммам категорий.
    const shares = allocate(
      linesSum - input.total.minor,
      sums.map((part) => part.value.minor),
    );
    sums.forEach((part, index) => {
      const share = node("receipts.categoryDiscount", { ...part.value, minor: shares[index] ?? 0 });
      const amount = sub("receipts.categorySplit", part, [share]);
      if (amount.value.minor > 0)
        result.push({ category: order[index] ?? "", amount, remainder: false });
    });
    return result;
  }
  sums.forEach((part, index) => {
    result.push({
      category: order[index] ?? "",
      amount: sub("receipts.categorySplit", part, [
        node("receipts.categoryDiscount", { ...part.value, minor: 0 }),
      ]),
      remainder: false,
    });
  });
  const rest = sub("receipts.unrecognizedRemainder", node("receipts.total", input.total), [
    node("receipts.linesSum", { ...input.total, minor: linesSum }),
  ]);
  result.push({ category: input.remainderKey, amount: rest, remainder: true });
  return result;
}
