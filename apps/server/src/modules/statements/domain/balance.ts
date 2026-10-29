// Сверка цепочки остатков (STMT-04 шаг 3): остаток на начало + операции = остаток на конец. Остатки — из шапки выписки,
// а если их там нет — из колонки «Остаток»: на начало = остаток после первой операции без неё. Не сошлось — «проверьте»:
// импорт не проходит молча. Сумма считается в @kosht/calc (P1) с трассой для «Откуда эта цифра?».
import { Money } from "@kosht/kernel";
import { balanceChainDifference, node } from "@kosht/calc";
import type { BalanceStatus, ParsedRow } from "./types.ts";

export interface BalanceCheck {
  readonly status: BalanceStatus;
  readonly opening?: Money;
  readonly closing?: Money;
  readonly difference?: Money;
  readonly trace?: unknown;
}

/** Операции по времени: если файл идёт от новых к старым (первая дата позже последней) — порядок разворачивается. */
function chronological(rows: readonly ParsedRow[]): readonly ParsedRow[] {
  const first = rows[0];
  const last = rows.at(-1);
  return first !== undefined && last !== undefined && first.date > last.date
    ? rows.toReversed()
    : rows;
}

export function checkBalance(
  rows: readonly ParsedRow[],
  currency: string,
  declared: {
    readonly openingMinor?: number | undefined;
    readonly closingMinor?: number | undefined;
  },
): BalanceCheck {
  const own = rows.filter((row) => row.amount.currency === currency);
  const ordered = chronological(own);
  const first = ordered[0];
  const last = ordered.at(-1);
  const opening =
    declared.openingMinor ??
    (first?.balance === undefined ? undefined : first.balance.minor - first.amount.minor);
  const closing = declared.closingMinor ?? last?.balance?.minor;
  if (opening === undefined || closing === undefined) {
    return {
      status: "unknown",
      ...(opening === undefined ? {} : { opening: Money.of(opening, currency) }),
      ...(closing === undefined ? {} : { closing: Money.of(closing, currency) }),
    };
  }
  const result = balanceChainDifference({
    opening: node("statements.openingBalance", Money.of(opening, currency)),
    operations: own.map((row) => node("statements.operation", row.amount)),
    closing: node("statements.closingBalance", Money.of(closing, currency)),
  });
  return {
    status: result.value.minor === 0 ? "ok" : "mismatch",
    opening: Money.of(opening, currency),
    closing: Money.of(closing, currency),
    difference: result.value,
    trace: result.trace,
  };
}
