// Параметры таблицы ставок (TAX-03, AFF-05): коды, единицы и группы. Значение хранится целым числом: деньги — копейки BYN
// (`byn-minor`), проценты — сотые доли процента (`percent-bp`: 13 % = 1300). Калькулятор берёт значение по коду и дате; новый
// параметр — строка здесь, а не правка схемы.
export const RATE_UNITS = ["byn-minor", "percent-bp"] as const;
export type RateUnit = (typeof RATE_UNITS)[number];

export interface RateParamDef {
  readonly param: string;
  readonly unit: RateUnit;
  /** Группа в админке и в словаре: стандартные вычеты, ставки подоходного налога, ИП, НПД, взнос ФСЗН, долговая нагрузка. */
  readonly group: "std-deduction" | "ndfl-rate" | "ip" | "npd" | "fszn" | "pdn";
}

export const RATE_PARAMS: readonly RateParamDef[] = [
  { param: "ndfl.std-deduction.base", unit: "byn-minor", group: "std-deduction" },
  { param: "ndfl.std-deduction.base-income-limit", unit: "byn-minor", group: "std-deduction" },
  { param: "ndfl.std-deduction.child", unit: "byn-minor", group: "std-deduction" },
  { param: "ndfl.std-deduction.child-increased", unit: "byn-minor", group: "std-deduction" },
  { param: "ndfl.std-deduction.disabled", unit: "byn-minor", group: "std-deduction" },
  { param: "ndfl.std-deduction.young-specialist", unit: "byn-minor", group: "std-deduction" },
  { param: "ndfl.rate.base", unit: "percent-bp", group: "ndfl-rate" },
  { param: "ndfl.rate.high", unit: "percent-bp", group: "ndfl-rate" },
  { param: "ndfl.rate.high-from", unit: "byn-minor", group: "ndfl-rate" },
  { param: "ndfl.rate.top", unit: "percent-bp", group: "ndfl-rate" },
  { param: "ndfl.rate.top-from", unit: "byn-minor", group: "ndfl-rate" },
  { param: "ip.rate.base", unit: "percent-bp", group: "ip" },
  { param: "ip.rate.high", unit: "percent-bp", group: "ip" },
  { param: "ip.rate.high-from", unit: "byn-minor", group: "ip" },
  { param: "npd.rate.base", unit: "percent-bp", group: "npd" },
  { param: "npd.rate.high", unit: "percent-bp", group: "npd" },
  { param: "npd.rate.high-from", unit: "byn-minor", group: "npd" },
  { param: "fszn.employee-rate", unit: "percent-bp", group: "fszn" },
  { param: "pdn.limit.default", unit: "percent-bp", group: "pdn" },
  { param: "pdn.limit.domestic-goods", unit: "percent-bp", group: "pdn" },
];

const BY_PARAM = new Map(RATE_PARAMS.map((p) => [p.param, p]));

export function paramDef(param: string): RateParamDef | undefined {
  return BY_PARAM.get(param);
}

/** Число из таблицы словами для сверки с текстом нормы: 21600 копеек → «216», 1300 → «13», 130050 → «1300,50». */
export function numberText(unit: RateUnit, value: number): string {
  const whole = Math.trunc(value / 100);
  const rest = value % 100;
  return rest === 0 ? String(whole) : `${String(whole)},${String(rest).padStart(2, "0")}`;
}

/**
 * Встречается ли число в тексте нормы (LAW-33): отдельным числом, а не частью другого («216» не найдено в «2160»), с пробелами
 * между разрядами («1 308», «1308»). Это сверка «похоже, число изменилось», а не разбор нормы: решает человек.
 */
export function textHasNumber(text: string, number: string): boolean {
  // Пробел между разрядами убираем только внутри числа: «1 308 белорусских» → «1308 белорусских».
  const squeezed = text.replace(/(?<=\d)[\s ](?=\d{3}(?!\d))/gu, "");
  const escaped = number.replace(/[.,]/gu, "[.,]");
  return new RegExp(`(?<![\\d.,])${escaped}(?![\\d]|[.,]\\d)`, "u").test(squeezed);
}
