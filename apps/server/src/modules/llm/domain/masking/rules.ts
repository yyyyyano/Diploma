// Правила маскирования без модели (PRIV-03): IBAN, номера карт, телефоны, email, идентификационный номер и серия
// паспорта, адреса. Чистые функции: текст → найденные отрезки. Склонённые имена — names.ts, NER — инфраструктура.
// Правила намеренно «щедрые»: лишняя метка стоит ответа модели, пропущенный номер — утечки (PRIV-03 важнее удобства).
import type { MaskKind } from "./labels.ts";

export interface Span {
  readonly start: number;
  readonly end: number;
  readonly kind: MaskKind;
}

/** Порядок приоритета при пересечении: меньше — сильнее (счёт важнее «телефона» внутри него). */
const PRIORITY: Readonly<Record<MaskKind, number>> = {
  iban: 0,
  card: 1,
  passport: 2,
  email: 3,
  phone: 4,
  address: 5,
  name: 6,
};

/** Контрольная сумма IBAN: mod 97 == 1 (ISO 13616). */
export function ibanChecksumOk(iban: string): boolean {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const ch of rearranged) {
    const value = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Алгоритм Луна для номера карты. */
export function luhnOk(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Отрезок до первого символа, на котором «чистых» знаков набралось `count` (пробелы и дефисы внутри не считаются). */
function endAfter(
  text: string,
  start: number,
  count: number,
  isSignificant: (ch: string) => boolean,
) {
  let seen = 0;
  for (let index = start; index < text.length; index += 1) {
    if (isSignificant(text[index] ?? "")) {
      seen += 1;
      if (seen === count) return index + 1;
    }
  }
  return text.length;
}

function* matches(text: string, pattern: RegExp): Generator<{ start: number; value: string }> {
  for (const match of text.matchAll(pattern)) yield { start: match.index, value: match[0] };
}

const IBAN =
  /(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}(?:[ -]?[A-Za-z0-9]{4}){3,7}(?:[ -]?[A-Za-z0-9]{1,4})?(?![A-Za-z0-9])/gu;

function ibans(text: string): Span[] {
  const found: Span[] = [];
  for (const { start, value } of matches(text, IBAN)) {
    const compact = value.replace(/[ -]/g, "").toUpperCase();
    // BY — 28 знаков: считаем ровно 28, лишняя «группа» справа — уже не счёт. Чужие страны — только с контрольной суммой.
    if (compact.startsWith("BY") && compact.length >= 28) {
      const end = endAfter(text, start, 28, (ch) => /[A-Za-z0-9]/.test(ch));
      found.push({ start, end, kind: "iban" });
      continue;
    }
    for (let length = Math.min(compact.length, 34); length >= 15; length -= 1) {
      if (ibanChecksumOk(compact.slice(0, length))) {
        found.push({
          start,
          end: endAfter(text, start, length, (ch) => /[A-Za-z0-9]/.test(ch)),
          kind: "iban",
        });
        break;
      }
    }
  }
  return found;
}

const CARD = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/gu;

function cards(text: string): Span[] {
  const found: Span[] = [];
  for (const { start, value } of matches(text, CARD)) {
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnOk(digits)) {
      found.push({ start, end: start + value.length, kind: "card" });
    }
  }
  return found;
}

const PHONES = [
  // +375 (29) 123-45-67, 375291234567, 00375…
  /(?<![\w+])(?:(?:\+|00)[ ]?)?375[ \-()]*\d{2,3}[ \-()]*\d{2,3}[ -]?\d{2}[ -]?\d{2}(?!\d)/gu,
  // 8 029 123-45-67, 8-029-1234567
  /(?<![\w+])8[ -]?\(?0?(?:17|25|29|33|44|152|162|212|222)\)?[ -]?\d{2,3}[ -]?\d{2}[ -]?\d{2}(?!\d)/gu,
  // любой международный номер с «+»
  /(?<![\w+])\+\d{1,3}[ \-()]*\d{2,4}[ \-()]*\d{3}[ -]?\d{2,4}[ -]?\d{0,4}(?!\d)/gu,
];

function phones(text: string): Span[] {
  const found: Span[] = [];
  for (const pattern of PHONES) {
    for (const { start, value } of matches(text, pattern)) {
      const digits = value.replace(/\D/g, "").length;
      if (digits >= 9 && digits <= 15) {
        found.push({ start, end: start + value.trimEnd().length, kind: "phone" });
      }
    }
  }
  return found;
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;

function emails(text: string): Span[] {
  return [...matches(text, EMAIL)].map(({ start, value }) => ({
    start,
    end: start + value.length,
    kind: "email" as const,
  }));
}

/** Идентификационный номер (3150384A001PB5) и серия + номер паспорта (KB1234567). */
const PASSPORT = [
  /(?<![A-Za-z0-9])\d{7}[A-Z]\d{3}[A-Z]{2}\d(?![A-Za-z0-9])/gu,
  /(?<![A-Za-z0-9])[A-Z]{2}[ ]?\d{7}(?![A-Za-z0-9])/gu,
];

function passports(text: string): Span[] {
  const found: Span[] = [];
  for (const pattern of PASSPORT) {
    for (const { start, value } of matches(text, pattern)) {
      found.push({ start, end: start + value.length, kind: "passport" });
    }
  }
  return found;
}

const STREET =
  "(?:ул\\.|улица|пр-т|пр\\.|просп\\.|проспект|пер\\.|переулок|б-р|бул\\.|бульвар|наб\\.|пл\\.|площадь|тракт|шоссе)";
const CITY = "(?:г\\.|гор\\.|город|аг\\.|гп\\.|д\\.|дер\\.|пос\\.|мкр\\.)";
const NAME = "[А-ЯЁA-Z][\\p{L}\\-]*";
const HOUSE = "(?:д\\.|дом|корп\\.|к\\.|кв\\.|оф\\.|пом\\.|стр\\.)\\s*\\d+[\\p{L}]?(?:/\\d+)?";
const ADDRESS = new RegExp(
  `(?:${CITY}\\s*${NAME},?\\s*)?${STREET}\\s*(?:${NAME}|\\d+-?[\\p{L}]*)(?:\\s+${NAME}){0,2}(?:,?\\s*(?:${HOUSE}|\\d+[\\p{L}]?(?:/\\d+)?))*(?:,?\\s*${HOUSE})*`,
  "gu",
);
const CITY_ONLY = new RegExp(`${CITY}\\s*${NAME}(?:,\\s*(?:${HOUSE}))+`, "gu");

function addresses(text: string): Span[] {
  const found: Span[] = [];
  for (const pattern of [ADDRESS, CITY_ONLY]) {
    for (const { start, value } of matches(text, pattern)) {
      found.push({
        start,
        end: start + value.trimEnd().replace(/[,;]$/, "").length,
        kind: "address",
      });
    }
  }
  return found;
}

/** Все отрезки правил, пересечения не разрешены (см. resolveOverlaps). */
export function detectByRules(text: string): Span[] {
  return [
    ...ibans(text),
    ...cards(text),
    ...passports(text),
    ...emails(text),
    ...phones(text),
    ...addresses(text),
  ];
}

/** Из пересекающихся отрезков остаются сильнейшие (вид, затем длина); результат — по возрастанию начала. */
export function resolveOverlaps(spans: readonly Span[]): Span[] {
  const ranked = spans.toSorted(
    (a, b) =>
      PRIORITY[a.kind] - PRIORITY[b.kind] ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start,
  );
  const kept: Span[] = [];
  for (const span of ranked) {
    if (span.end <= span.start) continue;
    if (kept.every((other) => span.end <= other.start || span.start >= other.end)) kept.push(span);
  }
  return kept.toSorted((a, b) => a.start - b.start);
}
