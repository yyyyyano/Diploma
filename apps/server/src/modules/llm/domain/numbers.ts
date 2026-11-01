// Проверка чисел ответа (AGT-04, P1): каждое число в тексте ответа должно быть в результатах инструментов, в сообщениях
// пользователя этого диалога, в сегодняшней дате и периоде или быть номером нормы («ст. 210», «п. 1.1»). Сравнение —
// по точному десятичному значению без float: «15», «15,00» и 1500 копеек — одно и то же число; знак не важен («−840,00»).
// Чистые функции: источники чисел набирает запуск агента.

/** Число как точная десятичная строка: «1234.56», «15», «0.5». */
export type Canonical = string;

function canonical(integerPart: string, fraction: string): Canonical {
  const int = integerPart.replace(/^0+(?=\d)/u, "") || "0";
  const frac = fraction.replace(/0+$/u, "");
  return frac === "" ? int : `${int}.${frac}`;
}

/** Число из текста («1 234,56», «15.5», «7») → каноническая строка. */
function fromText(raw: string): Canonical {
  const digits = raw.replace(/[\s  ]/gu, "").replace(",", ".");
  const [int = "0", fraction = ""] = digits.split(".");
  return canonical(int, fraction);
}

/** Копейки → рубли без деления с плавающей точкой: 123456 → «1234.56»; не целое число — как есть. */
export function fromNumber(value: number): Canonical[] {
  if (!Number.isFinite(value)) return [];
  const text = Math.abs(value).toString();
  if (/e/iu.test(text)) return [];
  if (!Number.isInteger(value)) {
    const [int = "0", fraction = ""] = text.split(".");
    return [canonical(int, fraction)];
  }
  const padded = text.padStart(3, "0");
  return [canonical(text, ""), canonical(padded.slice(0, -2), padded.slice(-2))];
}

// Дата и время — числа по отдельности: «31.10.2026» → 31, 10, 2026; «2026-09-01» → 2026, 9, 1; «14:37» → 14, 37.
const DATE_LIKE = /\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{1,2}:\d{2}(?::\d{2})?/gu;
// Номер нормы и подобная нумерация: «ст. 210», «п. 1.1», «статьи 209.1», «глава 16», «пп. 2».
const NORM_REF =
  /(?<![\p{L}\d])(?:ст|статья|статьи|статье|статью|п|пп|пункт|пункта|пункте|ч|часть|части|абз|абзац|подп|подпункт|гл|глава|главе|разд|раздел|№)\.?\s*\d+(?:\.\d+)*(?:-\d+)?/giu;
const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const URL = /https?:\/\/\S+/giu;
// LEGAL-03: метки цитат черновика — `[[F<uuid версии>]]` и `[[A<акт>]]`: цифры в id — не количества.
const CITE_LABEL = /\[\[[FA][^\]\s]*\]\]/gu;
const LIST_MARKER = /^[ \t]*\d{1,3}[.)](?=\s)/gmu;
// «2-х комнатная», «3-й»: числительное с окончанием — не количество.
const ORDINAL = /(?<![\p{L}\d_])\d+-(?:х|й|я|е|го|му|м|ми|ю|ом|ая|ой|ые|ых)(?![\p{L}])/giu;
const NUMBER =
  /(?<![\p{L}\d_.,])\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?(?![\d])|(?<![\p{L}\d_.,])\d+(?:[.,]\d+)?/gu;

/** Числа текста в канонической форме, без номеров норм, ссылок, нумерации списков и дат (их части — по отдельности). */
export function extractNumbers(text: string): Canonical[] {
  const found: Canonical[] = [];
  let rest = text
    .replace(CITE_LABEL, " ")
    .replace(URL, " ")
    .replace(LIST_MARKER, " ")
    .replace(NORM_REF, " ");
  rest = rest.replace(DATE_LIKE, (date) => {
    for (const part of date.match(/\d+/gu) ?? []) found.push(fromText(part));
    return " ";
  });
  rest = rest.replace(ORDINAL, " ");
  for (const match of rest.matchAll(NUMBER)) found.push(fromText(match[0]));
  return found;
}

/**
 * Числа, которые ответу разрешено называть: набираются из результатов инструментов (JSON любой глубины: копейки и рубли,
 * числа в строках), сообщений пользователя, даты и периода. Не набор «вообще всех чисел»: у запуска он свой.
 */
export class NumberLedger {
  readonly #known = new Set<Canonical>();

  /** Результат инструмента: числа и строки с числами — рекурсивно. */
  addJson(value: unknown, depth = 0): void {
    if (depth > 12 || value === null || value === undefined) return;
    if (typeof value === "number") {
      for (const n of fromNumber(value)) this.#known.add(n);
    } else if (typeof value === "string") {
      // Идентификаторы (uuid) — не количества: их цифры не должны «подтверждать» выдуманные числа.
      if (!OPAQUE_ID.test(value)) this.addText(value);
    } else if (Array.isArray(value)) {
      for (const item of value) this.addJson(item, depth + 1);
    } else if (typeof value === "object") {
      for (const item of Object.values(value)) this.addJson(item, depth + 1);
    }
  }

  /** Текст пользователя, дата, период: числа из него. Номера норм тоже — «ст. 210» из вопроса можно повторить. */
  addText(text: string): void {
    for (const n of extractNumbers(text)) this.#known.add(n);
    // Номер нормы из текста источника разрешает повтор в ответе.
    for (const match of text.matchAll(NORM_REF)) {
      for (const n of match[0].match(/\d+/gu) ?? []) this.#known.add(fromText(n));
    }
  }

  has(number: Canonical): boolean {
    return this.#known.has(number);
  }

  /** Числа текста, которых нет среди разрешённых (в порядке появления, без повторов). */
  unverified(text: string): Canonical[] {
    return [...new Set(extractNumbers(text).filter((n) => !this.#known.has(n)))];
  }

  /** Число из аргумента модели (значение графика): само число или копейки — рубли. */
  hasValue(value: number): boolean {
    return fromNumber(value).some((n) => this.#known.has(n));
  }
}
