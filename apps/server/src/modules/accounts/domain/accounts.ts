// Правила счетов (STMT-01, STMT-02, RCPT-10) — чистые функции: служебные счета, сдвиг остатка при новом начальном
// остатке, итоги в BYN с трассой. Курсы приходят входом (их запрашивает сценарий вне транзакции).
import { node, sum, toByn, type Calc, type FxRateInput } from "@kosht/calc";
import { Money } from "@kosht/kernel";

/** Счёт глазами правил: вид, валюта, остаток. */
export interface AccountFacts {
  readonly kind: string;
  readonly currency: string;
  readonly balanceMinor: number;
}

/**
 * Служебные счета не удаляются: «Наличные» в BYN (есть у каждого с самого начала, STMT-01) и «Карта, не указана»
 * (RCPT-10). Наличные в другой валюте человек заводит сам — их удалить можно.
 */
export function isProtected(account: Pick<AccountFacts, "kind" | "currency">): boolean {
  return account.kind === "unknown-card" || (account.kind === "cash" && account.currency === "BYN");
}

/** Накопительный счёт и вклад — деньги, отложенные под цели: их нет в «Доступно без накопительного». */
export function isSavings(kind: string): boolean {
  return kind === "savings" || kind === "deposit";
}

/** STMT-01: новый начальный остаток сдвигает остаток на ту же разницу (операции после него не трогаются). */
export function shiftBalance(balance: Money, from: Money, to: Money): Money {
  const shifted = sum("accounts.balance", [
    node("accounts.balance", balance),
    node("accounts.initialBalance", to),
    node("accounts.initialBalance", Money.of(-from.minor, from.currency)),
  ]);
  return shifted.value;
}

/** Остаток счёта как расчёт: лист трассы. */
export function balanceCalc(account: AccountFacts): Calc<Money> {
  return node("accounts.balance", Money.of(account.balanceMinor, account.currency));
}

/** Эквивалент остатка в BYN (STMT-09); BYN — как есть; курса нет — undefined. */
export function balanceInByn(
  account: AccountFacts,
  rate: FxRateInput | undefined,
): Calc<Money> | undefined {
  if (account.currency === "BYN") return balanceCalc(account);
  if (rate === undefined) return undefined;
  return toByn("accounts.balanceInByn", balanceCalc(account), rate);
}

/**
 * Итог в BYN по счетам (ключ — `accounts.total` или `accounts.available`): сумма эквивалентов; курса хотя бы одной
 * валюты нет — undefined (итог не показывают, а не считают нулём); счетов нет — 0 BYN.
 */
export function totalInByn(
  key: string,
  accounts: readonly AccountFacts[],
  rates: ReadonlyMap<string, FxRateInput>,
): Calc<Money> | undefined {
  const parts = accounts.map((account) => balanceInByn(account, rates.get(account.currency)));
  if (parts.some((part) => part === undefined)) return undefined;
  const [first, ...rest] = parts as Calc<Money>[];
  if (first === undefined) return node(key, Money.of(0, "BYN"));
  return sum(key, [first, ...rest]);
}
