// Параметры таблицы ставок (TAX-03, AFF-05, CAL-02, CAL-04): коды, единицы и группы. Значение хранится целым числом: деньги —
// копейки BYN (`byn-minor`), проценты — сотые доли процента (`percent-bp`: 13 % = 1300), срок гарантии — месяцы (`months`: 24),
// срок налога — день года (`month-day`: месяц × 100 + день, 15 ноября = 1115) или число месяца (`day-of-month`: 22). Калькулятор и
// календарь берут значение по коду и дате; новый параметр — строка здесь, а не правка схемы.
export const RATE_UNITS = [
  "byn-minor",
  "percent-bp",
  "months",
  "month-day",
  "day-of-month",
] as const;
export type RateUnit = (typeof RATE_UNITS)[number];

export interface RateParamDef {
  readonly param: string;
  readonly unit: RateUnit;
  /** Группа в админке и в словаре: стандартные вычеты, ставки подоходного налога, ИП, НПД, взнос ФСЗН, долговая нагрузка. */
  readonly group: "std-deduction" | "ndfl-rate" | "ip" | "npd" | "fszn" | "pdn" | "warranty";
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
  // CAL-04: гарантийный срок по умолчанию — ст. 21 Закона № 90-З («в течение двух лет со дня передачи»).
  { param: "warranty.default-months", unit: "months", group: "warranty" },
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

const MONTH_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

/** Число лет словами в родительном и именительном падеже: «двух лет», «два года» (нормы пишут срок словами). */
const YEAR_WORDS: readonly (readonly string[])[] = [
  ["одного", "один"],
  ["двух", "два"],
  ["трех", "трёх", "три"],
  ["четырех", "четырёх", "четыре"],
  ["пяти", "пять"],
  ["шести", "шесть"],
  ["семи", "семь"],
  ["восьми", "восемь"],
  ["девяти", "девять"],
  ["десяти", "десять"],
];

const MONTH_WORDS: readonly (readonly string[])[] = [
  ["одного", "один"],
  ["двух", "два"],
  ["трех", "трёх", "три"],
  ["четырех", "четырёх", "четыре"],
  ["пяти", "пять"],
  ["шести", "шесть"],
  ["семи", "семь"],
  ["восьми", "восемь"],
  ["девяти", "девять"],
  ["десяти", "десять"],
  ["одиннадцати", "одиннадцать"],
  ["двенадцати", "двенадцать"],
];

/** `слово` или `цифра`, затем единица («двух лет», «2 года», «шести месяцев»). */
function countedPhrase(count: number, words: readonly (readonly string[])[], unit: RegExp): RegExp {
  const forms = [String(count), ...(words[count - 1] ?? [])];
  return new RegExp(
    `(?<![\\p{L}\\d])(?:${forms.join("|")})\\s+(?:календарных\\s+)?${unit.source}`,
    "iu",
  );
}

/**
 * Встречается ли значение в тексте нормы (LAW-33, CAL-02, CAL-04): по единице параметра. Деньги и проценты — отдельным числом;
 * месяцы — «24 месяца», «шести месяцев», «двух лет» (срок, кратный году, записывают годами); день года — «15 ноября» (пробел и
 * неразрывный пробел одинаково); число месяца — «22-го числа». Это сверка «похоже, норма изменилась», а не разбор нормы.
 */
export function valueInText(unit: RateUnit, value: number, text: string): boolean {
  switch (unit) {
    case "byn-minor":
    case "percent-bp":
      return textHasNumber(text, numberText(unit, value));
    case "months": {
      if (countedPhrase(value, MONTH_WORDS, /месяц(?:а|ев)?/u).test(text)) return true;
      return (
        value >= 12 &&
        value % 12 === 0 &&
        value / 12 <= 10 &&
        countedPhrase(value / 12, YEAR_WORDS, /(?:год|года|лет)/u).test(text)
      );
    }
    case "month-day": {
      const month = MONTH_GENITIVE[Math.trunc(value / 100) - 1];
      const day = value % 100;
      if (month === undefined || day < 1 || day > 31) return false;
      return new RegExp(`(?<![\\d])${String(day)}\\s+${month}(?![\\p{L}])`, "u").test(text);
    }
    case "day-of-month":
      return new RegExp(`(?<![\\d])${String(value)}(?:-го|-е)?\\s+числа`, "u").test(text);
  }
}
