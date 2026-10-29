// Форматы чисел «Запросов к ИИ» (ADM-20, DES-17): числа считает сервер — здесь только запись целых в удобном виде
// (тысячи, миллионы, доллары, секунды, доли). Без float и Intl: разряды и дробь собираются из целых, как в @kosht/i18n.
import { formatScaled } from "@kosht/i18n";

const NBSP = String.fromCharCode(0xa0);

export interface AiUnits {
  readonly million: string;
  readonly thousand: string;
  readonly second: string;
  readonly millisecond: string;
}

/** Разряды целого: «1 234 567» (неразрывный пробел). */
export function groupDigits(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Токены: до 10 тыс. — целым, дальше «128 тыс.» и «1,24 млн». */
export function formatTokens(tokens: number, units: AiUnits): string {
  if (tokens >= 1_000_000) {
    return `${formatScaled(Math.round(tokens / 10_000), 2)}${NBSP}${units.million}`;
  }
  if (tokens >= 10_000) return `${groupDigits(Math.round(tokens / 1000))}${NBSP}${units.thousand}`;
  return groupDigits(tokens);
}

/** Условная стоимость: микродоллары → «$0,84»; меньше цента, но не ноль — «< $0,01». */
export function formatCostMicros(micros: number): string {
  if (micros > 0 && micros < 10_000) return `<${NBSP}$0,01`;
  return `$${formatScaled(Math.round(micros / 10_000), 2)}`;
}

/** Время ответа: «850 мс», «2,1 с»; нет данных — тире. */
export function formatMs(ms: number | null, units: AiUnits): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${String(ms)}${NBSP}${units.millisecond}`;
  return `${formatScaled(Math.round(ms / 100), 1)}${NBSP}${units.second}`;
}

/** Промилле → «1,4 %». */
export function formatPermille(permille: number): string {
  return `${formatScaled(permille, 1)}${NBSP}%`;
}

/** Микродоллары за миллион токенов ↔ доллары за миллион (ввод цены в прайс-листе): «0,59». */
export function microsToDollars(micros: number): string {
  return formatScaled(micros, 6).replace(/0+$/, "").replace(/,$/, "") || "0";
}

/** Введённые доллары («0,59», «0.59») → микродоллары; не число — undefined. */
export function dollarsToMicros(text: string): number | undefined {
  const match = /^(\d{1,6})(?:[.,](\d{1,6}))?$/.exec(text.trim());
  if (match === null) return undefined;
  return Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(6, "0"));
}
