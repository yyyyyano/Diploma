// Раскладка главного экрана (DASH-02): какие категории показать рядами, а какие свернуть в «Остальное», и какие шесть
// месяцев идут в динамику. Чистая арифметика над ключами и днями — деньги считает calc.
import { LocalDate } from "@kosht/kernel";

export interface Ranked {
  readonly key: string;
  /** Копейки расходов группы: по ним порядок; сумму (`Calc`) сценарий берёт у самой группы. */
  readonly minor: number;
}

/**
 * Крупнейшие категории по расходам (не больше `max`) и остальные. В расходах — только положительные суммы: категория,
 * где возвратов больше покупок, и нулевые на диаграмме не рисуются. При равных суммах порядок — по ключу (стабильно).
 */
export function splitTop<T extends Ranked>(
  groups: readonly T[],
  max: number,
): { readonly top: T[]; readonly rest: T[] } {
  const ranked = groups
    .filter((group) => group.minor > 0)
    .toSorted((a, b) => b.minor - a.minor || a.key.localeCompare(b.key));
  return { top: ranked.slice(0, max), rest: ranked.slice(max) };
}

/** Месяц «ГГГГ-ММ» дня периода. */
export function monthOfDay(day: LocalDate): string {
  return day.slice(0, 7);
}

/** `count` месяцев по возрастанию, последний — `last` («2026-10» → …, «2026-05», …, «2026-10»). */
export function monthsEndingAt(last: string, count: number): string[] {
  const [year = 0, month = 1] = last.split("-").map(Number);
  const index = year * 12 + (month - 1);
  return Array.from({ length: count }, (_, step) => {
    const at = index - (count - 1 - step);
    return `${String(Math.floor(at / 12)).padStart(4, "0")}-${String((at % 12) + 1).padStart(2, "0")}`;
  });
}
