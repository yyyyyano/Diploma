// scrub() — страховка для текста ошибок, который пишется в лог (OBS-02, OBS-04, ADR-0010): вычищает то, что
// узнаётся по форме, — email, номер карты (проверка Луна, чтобы не трогать id и метки времени) и белорусский IBAN.
// Значения без формы (название товара, сумма, текст документа) scrub не видит: поэтому в лог идут ключ события и
// поля из белого списка (logger.ts), а у ошибок БД сообщение не пишется вовсе (serialize-error.ts).

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
/** 13–19 цифр, допускаются одиночные пробелы и дефисы между ними (4111 1111 1111 1111). */
const CARD_CANDIDATE = /(?<![\p{N}])\p{N}(?:[ -]?\p{N}){12,18}(?![\p{N}])/gu;
/** IBAN BY: BY + 2 контрольные цифры + 24 буквы и цифры, допускаются пробелы между группами. */
const IBAN_BY = /\bBY\d{2}(?:[ ]?[A-Z0-9]){24}\b/giu;

/** Текст без email, номеров карт и IBAN BY. */
export function scrub(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(IBAN_BY, "[iban]")
    .replace(CARD_CANDIDATE, (match) => (luhn(match.replace(/[ -]/g, "")) ? "[card]" : match));
}

/** Контрольная сумма Луна; только ASCII-цифры. */
function luhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
