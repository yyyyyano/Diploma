// Типы операций выписки (STMT-08): по описанию и знаку — расход, доход, возврат, перевод; снятие наличных, пополнение
// вклада и платёж по кредиту — особые случаи. Чистые правила без модели: слова банков («Снятие наличных», «Перевод между
// своими», «Погашение кредита») разные, но немногочисленные; чего правила не знают — обычный расход или доход, а
// спорное («Перевод» без пары — себе или другому человеку?) помечается и уходит на подтверждение пакетом.
import type { Money } from "@kosht/kernel";

export type RowKind = "expense" | "income" | "refund" | "transfer";

/** Почему операция — перевод (для пары и для вопроса человеку). */
export type TransferReason = "cash" | "deposit" | "own" | "person";

export interface Classified {
  readonly kind: RowKind;
  readonly direction: "in" | "out";
  /** Встроенная категория, которую диктует смысл («Зарплата», «Кредиты и займы»); иначе — подбор по контрагенту. */
  readonly categoryCode?: "salary" | "side-income" | "benefits" | "interest" | "loans" | "refunds";
  /** Перевод: наличные, вклад, «между своими» или «перевод» без пояснений. */
  readonly transfer?: TransferReason;
  /** Спорное: «перевод» без пары — свой счёт или другой человек; решает человек (пакет «Да/Нет»). */
  readonly doubtful: boolean;
}

/** Нижний регистр, «ё» → «е», пробелы схлопнуты: ключ слов и ключ дубля. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

const CASH_OUT = /снят\S*\s+налич|выдач\S*\s+налич|банкомат|\batm\b|cash\s*(withdrawal|advance)/u;
const CASH_IN = /(внесен|пополнен|взнос)\S*\s+налич|cash\s*deposit|cash-in/u;
const INTEREST = /процент\S*\s+(по|на)|начислен\S*\s+процент|interest/u;
const DEPOSIT = /вклад|депозит|накопительн|deposit\b|savings/u;
const OWN =
  /между\s+своими|между\s+счетами|собственн\S*\s+(счет|карт)|себе(?!\p{L})|own\s+account/u;
const TRANSFER = /перевод|transfer|p2p|c2c|\bsbp\b|(?<!\p{L})сбп(?!\p{L})/u;
const REFUND =
  /возврат\s+(платеж|покупк|средств|денег)|(?<!\p{L})возврат(?!\p{L})|refund|reversal|отмена\s+(покупки|операции)/u;
const SALARY = /зарплат|заработн|оплата\s+труда|salary|payroll|аванс|премия/u;
const SELF_EMPLOYED = /(?<!\p{L})нпд(?!\p{L})|самозанят|профессиональн\S*\s+доход/u;
const BENEFITS = /пособи|пенси|алимент|социальн\S*\s+(выплат|помощ)|материнск|стипенди/u;
const LOAN = /кредит|погашение\s+(основного|долга|займа)|займ|loan\s+(payment|repayment)|рассрочк/u;

/** Тип одной операции по знаку суммы (со стороны счёта) и описанию. */
export function classifyRow(description: string, amount: Money): Classified {
  const text = normalizeText(description);
  const incoming = amount.minor > 0;
  const base = { direction: incoming ? ("in" as const) : ("out" as const), doubtful: false };
  if (!incoming && CASH_OUT.test(text)) return { ...base, kind: "transfer", transfer: "cash" };
  if (incoming && CASH_IN.test(text)) return { ...base, kind: "transfer", transfer: "cash" };
  if (incoming && INTEREST.test(text)) return { ...base, kind: "income", categoryCode: "interest" };
  if (OWN.test(text)) return { ...base, kind: "transfer", transfer: "own" };
  if (DEPOSIT.test(text) && !LOAN.test(text))
    return { ...base, kind: "transfer", transfer: "deposit" };
  if (incoming && REFUND.test(text)) return { ...base, kind: "refund", categoryCode: "refunds" };
  if (incoming) {
    if (SALARY.test(text)) return { ...base, kind: "income", categoryCode: "salary" };
    if (SELF_EMPLOYED.test(text)) return { ...base, kind: "income", categoryCode: "side-income" };
    if (BENEFITS.test(text)) return { ...base, kind: "income", categoryCode: "benefits" };
  }
  if (TRANSFER.test(text)) {
    // Без пары неясно, свой это счёт или человек: расход/доход по умолчанию, вопрос — человеку.
    return { ...base, kind: incoming ? "income" : "expense", transfer: "person", doubtful: true };
  }
  if (!incoming && LOAN.test(text)) return { ...base, kind: "expense", categoryCode: "loans" };
  return { ...base, kind: incoming ? "income" : "expense" };
}

/** Операция или кандидат пары: день, направление, сумма (модуль) и валюта. */
export interface PairSide {
  readonly date: string;
  readonly direction: "in" | "out";
  readonly minor: number;
  readonly currency: string;
}

/** Дней между двумя днями ISO (по модулю). */
export function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Пара перевода (STMT-08): «списание тут — зачисление там» на ту же сумму в той же валюте, противоположное
 * направление, не дальше `windowDays` дней (по умолчанию 3). Из нескольких — ближайший по дню, при равенстве — первый.
 */
export function findCounterpart<T extends PairSide>(
  row: PairSide,
  candidates: readonly T[],
  windowDays: number,
): T | undefined {
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.direction === row.direction) continue;
    if (candidate.currency !== row.currency || candidate.minor !== row.minor) continue;
    const distance = daysBetween(candidate.date, row.date);
    if (distance <= windowDays && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Покупка, к которой может относиться возврат. */
export interface PurchaseSide {
  readonly date: string;
  readonly merchantKey: string | null;
  readonly minor: number;
  readonly currency: string;
}

/**
 * Покупка возврата (STMT-08): тот же контрагент и валюта, сумма возврата не больше покупки, покупка не позже возврата
 * и не раньше окна `windowDays`; из нескольких — самая поздняя.
 */
export function findPurchase<T extends PurchaseSide>(
  refund: PurchaseSide,
  purchases: readonly T[],
  windowDays: number,
): T | undefined {
  if (refund.merchantKey === null) return undefined;
  let best: T | undefined;
  for (const purchase of purchases) {
    if (purchase.merchantKey !== refund.merchantKey || purchase.currency !== refund.currency)
      continue;
    if (purchase.minor < refund.minor || purchase.date > refund.date) continue;
    if (daysBetween(purchase.date, refund.date) > windowDays) continue;
    if (best === undefined || purchase.date > best.date) best = purchase;
  }
  return best;
}
