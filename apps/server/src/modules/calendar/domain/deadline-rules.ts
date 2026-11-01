// Правила сроков налогов (CAL-02): какой факт профиля включает правило, какой параметр таблицы ставок даёт срок и на какие дни
// создаются события. Срок — только подтверждённое значение `norm_rates` (`deadline.*`), чисел «из головы» здесь нет: правило хранит
// имя параметра, а не дату. Правило без параметра (`param: null`) — норма не связывает срок с датой: событие без дня, день укажет
// человек. «Сегодня» приходит аргументом.
import { LocalDate } from "@kosht/kernel";

export const RULE_KEYS = [
  "property-tax",
  "land-tax",
  "transport-tax",
  "npd-payment",
  "declaration",
  "declaration-deduction",
  "inspection",
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

/** Факты, от которых зависят правила (значения профиля и найденные вычеты). */
export interface RuleFacts {
  readonly apartment: boolean;
  readonly land: boolean;
  readonly car: boolean;
  readonly npd: boolean;
  readonly ip: boolean;
  /** Налоговые годы найденных вычетов, по которым вычет получают через ИМНС (ст. 222: декларация — до 31 марта следующего года). */
  readonly deductionYears: readonly number[];
}

export interface DeadlineRule {
  readonly key: RuleKey;
  /** Параметр таблицы ставок со сроком; `null` — срок не привязан к дате (CAL-02). */
  readonly param: string | null;
  readonly cadence: "yearly" | "monthly" | "undated" | "per-deduction";
  readonly enabled: (facts: RuleFacts) => boolean;
}

export const DEADLINE_RULES: readonly DeadlineRule[] = [
  // ст. 233 п. 5 НК — физические лица, факт «есть квартира»
  {
    key: "property-tax",
    param: "deadline.property-tax",
    cadence: "yearly",
    enabled: (f) => f.apartment,
  },
  // ст. 244 п. 8.1 НК — факт «есть участок»
  { key: "land-tax", param: "deadline.land-tax", cadence: "yearly", enabled: (f) => f.land },
  // ст. 307⁸ п. 2 НК — факт «есть автомобиль»
  {
    key: "transport-tax",
    param: "deadline.transport-tax",
    cadence: "yearly",
    enabled: (f) => f.car,
  },
  // ст. 381⁷ п. 2 НК — плательщик НПД: 22-е число каждого месяца
  { key: "npd-payment", param: "deadline.npd-payment", cadence: "monthly", enabled: (f) => f.npd },
  // ст. 222 п. 1 НК — ИП подаёт декларацию до 31 марта
  { key: "declaration", param: "deadline.declaration", cadence: "yearly", enabled: (f) => f.ip },
  // ст. 222 п. 1 НК — найденный вычет через ИМНС: декларация за год основания, до 31 марта следующего
  {
    key: "declaration-deduction",
    param: "deadline.declaration",
    cadence: "per-deduction",
    enabled: (f) => f.deductionYears.length > 0,
  },
  // Техосмотр: срок зависит от даты осмотра, а не от календаря — событие без дня, дату назовёт человек (CAL-02).
  { key: "inspection", param: null, cadence: "undated", enabled: (f) => f.car },
];

/** Сколько месяцев вперёд создаются ежемесячные события (НПД): дальше — при следующем открытии календаря. */
export const MONTHLY_HORIZON = 6;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** День месяца, которого нет в месяце (29 февраля, 31 апреля), — последний день месяца. */
function dayOf(year: number, month: number, day: number): LocalDate {
  return LocalDate.parse(
    `${pad(year, 4)}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`,
  );
}

/** Значение единицы `month-day` (месяц × 100 + день) в день заданного года; битое значение — `null`. */
function monthDayIn(year: number, value: number): LocalDate | null {
  const month = Math.trunc(value / 100);
  const day = value % 100;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return dayOf(year, month, day);
}

/**
 * Дни событий правила на сегодня. `yearly` — ближайший срок (в этом году, если не прошёл, иначе в следующем); `monthly` — ближайшие
 * `MONTHLY_HORIZON` сроков; `per-deduction` — по сроку на каждый год основания (год + 1), прошедшие не создаются.
 */
export function ruleDays(
  rule: Pick<DeadlineRule, "cadence">,
  unit: "month-day" | "day-of-month",
  value: number,
  facts: Pick<RuleFacts, "deductionYears">,
  today: LocalDate,
): LocalDate[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (rule.cadence) {
    case "undated":
      return [];
    case "yearly": {
      if (unit !== "month-day") return [];
      const thisYear = monthDayIn(year, value);
      if (thisYear === null) return [];
      const next = thisYear >= today ? thisYear : monthDayIn(year + 1, value);
      return next === null ? [] : [next];
    }
    case "monthly": {
      if (unit !== "day-of-month" || value < 1 || value > 31) return [];
      const days: LocalDate[] = [];
      for (let step = 0; days.length < MONTHLY_HORIZON && step < MONTHLY_HORIZON + 1; step += 1) {
        const index = year * 12 + (month - 1) + step;
        const day = dayOf(Math.floor(index / 12), (index % 12) + 1, value);
        if (day >= today) days.push(day);
      }
      return days;
    }
    case "per-deduction": {
      if (unit !== "month-day") return [];
      return facts.deductionYears
        .toSorted((a, b) => a - b)
        .flatMap((y) => {
          const day = monthDayIn(y + 1, value);
          return day !== null && day >= today ? [day] : [];
        });
    }
  }
}

/** Ключ идемпотентности события правила (`rule:<правило>:<год>` или `…:<ГГГГ-ММ>`; без даты — `rule:<правило>`): повтор дубль не создаёт. */
export function eventKey(
  rule: Pick<DeadlineRule, "key" | "cadence">,
  day: LocalDate | null,
): string {
  if (day === null || rule.cadence === "undated") return `rule:${rule.key}`;
  return rule.cadence === "monthly"
    ? `rule:${rule.key}:${day.slice(0, 7)}`
    : `rule:${rule.key}:${day.slice(0, 4)}`;
}

/** Правило события по его ключу идемпотентности; не событие правила — `undefined`. */
export function ruleOfKey(key: string | null): DeadlineRule | undefined {
  if (key === null || !key.startsWith("rule:")) return undefined;
  const name = key.split(":")[1];
  return DEADLINE_RULES.find((rule) => rule.key === name);
}
