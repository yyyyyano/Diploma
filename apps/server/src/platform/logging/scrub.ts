// scrub() — страховка для текста ошибок, который пишется в лог (OBS-02, OBS-04, ADR-0010): вычищает то, что
// узнаётся по форме, — email, номер карты (проверка Луна, чтобы не трогать id и метки времени) и белорусский IBAN.
// Значения без формы (название товара, сумма, текст документа) scrub не видит: поэтому в лог идут ключ события и
// поля из белого списка (logger.ts), а у ошибок БД сообщение не пишется вовсе (serialize-error.ts).

/**
 * Email ищется от «@»: регэксп находит «@домен», локальная часть — проход назад от «@» по её символам до конца
 * прошлой замены. Регэксп с локальной частью впереди квадратичен на длинной серии без «@» (каждая позиция серии
 * сканирует её до конца), а lookbehind «начало серии» теряет адрес, склеенный с прошлым (`a@b.cc_x@d.ee`): серию
 * начал съеденный первым адресом символ. Проход назад линеен (участки проходов не пересекаются), находит то же, что
 * регэксп без ограничений, и не режет длинную локальную часть: адрес любой длины (и > 64 символов RFC 5321)
 * заменяется целиком, без обрезка до или после.
 */
const EMAIL_DOMAIN = /@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const LOCAL_CHAR = /^[\p{L}\p{N}._%+-]$/u;
/**
 * Серия цифр через одиночные пробелы и дефисы; карта в ней — группы подряд (13–19 цифр, Луна). Граница карты — только
 * на разделителе: цифры слитной группы длиннее 19 (id, метки времени) не режутся на «карты».
 */
const DIGIT_RUN = /\p{N}(?:[ -]?\p{N})*/gu;
/**
 * IBAN BY: BY + 2 контрольные цифры + 24 буквы и цифры, допускаются пробелы между группами. Без `\b`: `_`, цифра или
 * буква вплотную (`statement_BY13…`, два IBAN слитно) не прячут номер. Ищется первым, до email и карт: иначе зона
 * домена съедает «BY» (`x@y.zzBY13…`), а серия цифр — хвост номера (`…AB004111…`).
 */
const IBAN_BY = /BY\d{2}(?:[ ]?[A-Z0-9]){24}/giu;
const IBAN_MARK = "[iban]";

/** Текст без email, номеров карт и IBAN BY. */
export function scrub(text: string): string {
  return scrubEmails(text.replace(IBAN_BY, IBAN_MARK)).replace(DIGIT_RUN, maskCards);
}

function scrubEmails(text: string): string {
  let result = "";
  let copied = 0;
  for (const match of text.matchAll(EMAIL_DOMAIN)) {
    const start = localPartStart(text, match.index, copied);
    if (start === match.index) continue;
    result += `${text.slice(copied, start)}[email]`;
    copied = match.index + match[0].length;
  }
  return result + text.slice(copied);
}

/** Начало локальной части перед `at`, не левее `floor`; `[iban]` внутри неё (IBAN в адресе) входит в адрес. */
function localPartStart(text: string, at: number, floor: number): number {
  let index = at;
  while (index > floor) {
    if (index - IBAN_MARK.length >= floor && text.endsWith(IBAN_MARK, index)) {
      index -= IBAN_MARK.length;
      continue;
    }
    const width = index - 2 >= floor && isSurrogatePair(text, index - 2) ? 2 : 1;
    if (!isLocalChar(text.slice(index - width, index))) break;
    index -= width;
  }
  return index;
}

function isSurrogatePair(text: string, index: number): boolean {
  const high = text.charCodeAt(index);
  const low = text.charCodeAt(index + 1);
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
}

function isLocalChar(char: string): boolean {
  const code = char.charCodeAt(0);
  if (code < 0x80) return /[\w.%+-]/.test(char);
  return LOCAL_CHAR.test(char);
}

/**
 * Карты в серии цифр: слева направо самая длинная подходящая цепочка групп → `[card]`, разделители остаются.
 * Луна удваивает каждую вторую цифру справа, так что сумма цепочки `first..last` — разность префиксных сумм той
 * чётности, что задаёт её последняя цифра. Цепочка верна, если остатки по 10 у обеих префиксных сумм равны: для
 * каждого `first` нужна самая дальняя группа окна (13–19 цифр) с ключом «чётность, остаток» — её помнит `latest`.
 * Окно только сдвигается вправо: проход линеен и на «1 1 1 …» в миллион символов.
 */
function maskCards(run: string): string {
  const { count, start, end, digits, evenDoubled, oddDoubled, foreign } = digitGroups(run);
  const latest = new Int32Array(20).fill(-1);
  let result = "";
  let copied = 0;
  let first = 0;
  let last = -1;
  while (first < count) {
    const before = digits[first] ?? 0;
    last = Math.max(last, first - 1);
    // Окно растёт, пока цепочка не длиннее 19 цифр и в ней нет не-ASCII цифр.
    while (
      last + 1 < count &&
      (digits[last + 2] ?? 0) - before <= 19 &&
      foreign[last + 2] === foreign[first]
    ) {
      last += 1;
      const after = digits[last + 1] ?? 0;
      const parity = (after - 1) % 2;
      latest[parity * 10 + (((parity === 1 ? evenDoubled : oddDoubled)[last + 1] ?? 0) % 10)] =
        last;
    }
    const card = Math.max(
      latest[10 + ((evenDoubled[first] ?? 0) % 10)] ?? -1,
      latest[(oddDoubled[first] ?? 0) % 10] ?? -1,
    );
    if (card < first || (digits[card + 1] ?? 0) - before < 13) {
      first += 1;
      continue;
    }
    result += `${run.slice(copied, start[first])}[card]`;
    copied = end[card] ?? run.length;
    first = card + 1;
  }
  return result === "" ? run : result + run.slice(copied);
}

/**
 * Группы серии и префиксные суммы по ним: число цифр, сумма Луна для обеих чётностей (удвоены цифры на чётных или на
 * нечётных местах слева), число не-ASCII цифр. Проверка цепочки групп — O(1), без прохода по её цифрам.
 */
interface DigitGroups {
  count: number;
  start: Int32Array;
  end: Int32Array;
  digits: Int32Array;
  evenDoubled: Int32Array;
  oddDoubled: Int32Array;
  foreign: Int32Array;
}

function digitGroups(run: string): DigitGroups {
  const capacity = Math.ceil((run.length + 1) / 2) + 1;
  const groups: DigitGroups = {
    count: 0,
    start: new Int32Array(capacity),
    end: new Int32Array(capacity),
    digits: new Int32Array(capacity),
    evenDoubled: new Int32Array(capacity),
    oddDoubled: new Int32Array(capacity),
    foreign: new Int32Array(capacity),
  };
  let digits = 0;
  let evenDoubled = 0;
  let oddDoubled = 0;
  let foreign = 0;
  for (let index = 0; index <= run.length; index += 1) {
    const code = run.charCodeAt(index);
    if (index === run.length || code === 0x20 || code === 0x2d) {
      groups.end[groups.count] = index;
      groups.count += 1;
      groups.start[groups.count] = index + 1;
      groups.digits[groups.count] = digits;
      groups.evenDoubled[groups.count] = evenDoubled;
      groups.oddDoubled[groups.count] = oddDoubled;
      groups.foreign[groups.count] = foreign;
      continue;
    }
    const digit = code - 0x30;
    if (digit < 0 || digit > 9) foreign += 1;
    else {
      const doubled = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
      evenDoubled += digits % 2 === 0 ? doubled : digit;
      oddDoubled += digits % 2 === 0 ? digit : doubled;
    }
    digits += 1;
  }
  return groups;
}
