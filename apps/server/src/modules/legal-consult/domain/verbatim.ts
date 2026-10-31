// LEGAL-03, P3: «цитата дословна» проверяется программой. Сравнение — после нормализации (пробелы, кавычки, ё/е, дефисы,
// регистр): модель вправе поставить другие кавычки или перенос строки, но не другое слово и не другое число. Чистая функция.

const INVISIBLE = /[­​-‍⁠﻿]/gu;
const SPACES = /[\s   -   　]+/gu;
const QUOTES = /[«»„“”‟‹›"]/gu;
const APOSTROPHES = /[‘’‚‛'`´]/gu;
// Дефис, неразрывный дефис, цифровое, короткое, длинное тире, горизонтальная черта, минус.
const DASHES = /[‐-―−]/gu;
const ALNUM = /[\p{L}\p{N}]/u;
// Пропуск в цитате: «…», «...», «[…]», «[...]», «(…)»: куски вокруг него должны идти в тексте по порядку.
const ELLIPSIS = /\[\s*(?:…|\.{2,})\s*\]|\(\s*(?:…|\.{2,})\s*\)|…|\.{2,}/gu;

/**
 * Привести текст к виду для сверки: Unicode NFC без невидимых знаков, один вид кавычек, апострофа и дефиса, ё → е, нижний
 * регистр, пробелы схлопнуты. Идемпотентна.
 */
export function normalizeForQuote(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(QUOTES, '"')
    .replace(APOSTROPHES, "'")
    .replace(DASHES, "-")
    .replaceAll("ё", "е")
    .normalize("NFC")
    .replace(SPACES, " ")
    .trim();
}

/** Сколько слов (последовательностей букв и цифр) в тексте: порог для «длинной» цитаты без метки. */
export function wordCount(text: string): number {
  return text.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== "").length;
}

/**
 * Найти кусок в тексте начиная с `from`, не посреди слова: «21» не принимается за начало «216», «рубле» — за «рублей».
 * Возвращает позицию конца найденного или -1.
 */
function findPiece(source: string, piece: string, from: number): number {
  const first = piece[0] ?? "";
  const last = piece[piece.length - 1] ?? "";
  let at = source.indexOf(piece, from);
  while (at !== -1) {
    const end = at + piece.length;
    const before = at === 0 ? "" : (source[at - 1] ?? "");
    const after = end >= source.length ? "" : (source[end] ?? "");
    const startsOk = !(ALNUM.test(first) && before !== "" && ALNUM.test(before));
    const endsOk = !(ALNUM.test(last) && after !== "" && ALNUM.test(after));
    if (startsOk && endsOk) return end;
    at = source.indexOf(piece, at + 1);
  }
  return -1;
}

/**
 * Дословна ли цитата: каждый её кусок (между многоточиями) встречается в тексте фрагмента по порядку, целыми словами, и
 * содержит букву или цифру. Пустая цитата и цитата из одних знаков — нет.
 */
export function isVerbatim(quote: string, source: string): boolean {
  const pieces = quote
    .replace(INVISIBLE, "")
    .split(ELLIPSIS)
    .map(normalizeForQuote)
    .filter((piece) => piece !== "");
  if (pieces.length === 0 || pieces.some((piece) => !ALNUM.test(piece))) return false;
  const text = normalizeForQuote(source);
  let from = 0;
  for (const piece of pieces) {
    const end = findPiece(text, piece, from);
    if (end === -1) return false;
    from = end;
  }
  return true;
}
