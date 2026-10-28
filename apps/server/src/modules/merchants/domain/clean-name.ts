// Очистка названий контрагентов (STMT-06) и нормализация наименований позиций чека (RCPT-15) — чистые функции.
// Описание из выписки — данные, а не инструкция (STMT-12): здесь оно только чистится от технического шума — номеров
// терминалов, адресов, кодов MCC, служебных префиксов и организационно-правовых форм. Исходное описание хранит тот, кто
// его прислал (операция), здесь оно не меняется.

/** Формы собственности в начале описания (латиницей и кириллицей). */
const PREFIX_WORDS = new Set([
  "OOO",
  "ООО",
  "OAO",
  "ОАО",
  "ZAO",
  "ЗАО",
  "ODO",
  "ОДО",
  "CHUP",
  "ЧУП",
  "CHTUP",
  "ЧТУП",
  "UP",
  "УП",
  "IP",
  "ИП",
  "SP",
]);

/** Служебные слова платёжной системы — убираются в любом месте описания. */
const SERVICE_WORDS = new Set([
  "POS",
  "PURCHASE",
  "POKUPKA",
  "ПОКУПКА",
  "OPLATA",
  "ОПЛАТА",
  "RETAIL",
  "CARD",
  "KARTA",
  "КАРТА",
  "BEZNAL",
  "БЕЗНАЛ",
]);

/** Слова, с которых начинается адрес: город, улица, страна — всё после них отбрасывается. */
const ADDRESS_WORDS = new Set([
  "G",
  "Г",
  "MINSK",
  "МИНСК",
  "GOMEL",
  "ГОМЕЛЬ",
  "BREST",
  "БРЕСТ",
  "GRODNO",
  "ГРОДНО",
  "VITEBSK",
  "ВИТЕБСК",
  "MOGILEV",
  "МОГИЛЕВ",
  "UL",
  "УЛ",
  "PR",
  "ПР",
  "PROSP",
  "ПРОСП",
  "PER",
  "ПЕР",
  "BY",
  "BLR",
  "BELARUS",
  "БЕЛАРУСЬ",
  "RB",
  "РБ",
]);

/** Номер терминала: T-0042, TERM 12345, ТЕРМ.77, №123 (NFKC превращает «№» в «No»). */
const TERMINAL = /\b(?:T|TERM|TERMINAL|Т|ТЕРМ|ТЕРМИНАЛ)[-.\s]?\d{2,}\b|(?:№|\bNO\.?)\s*\d+\b/gu;
const MCC = /\bMCC\s*:?\s*(\d{4})\b/u;

export interface CleanedName {
  /** Ключ сравнения: верхний регистр, без шума — «EVROTORG», «ТАКСИ». Пусто — шум целиком. */
  readonly key: string;
  /** MCC из описания, если был. */
  readonly mcc: string | null;
}

/** STMT-06: «OOO EVROTORG T-0042 MINSK UL…» → ключ «EVROTORG». */
export function cleanDescription(raw: string): CleanedName {
  let text = raw.normalize("NFKC").toUpperCase();
  const mcc = MCC.exec(text)?.[1] ?? null;
  text = text.replace(MCC, " ").replace(TERMINAL, " ");
  // Кавычки, скобки, знаки — в пробелы; дефис внутри слова и точка-сокращение остаются до разбиения на слова.
  text = text.replace(/[«»"'“”„()[\]{},;:/\\*|+_!?]/gu, " ");
  const words = text.split(/\s+/u).filter((word) => word !== "");
  const cut = words.findIndex((word) => ADDRESS_WORDS.has(word.replace(/\.+$/u, "")));
  const kept = (cut === -1 ? words : words.slice(0, cut))
    .map((word) => word.replace(/^\.+|\.+$/gu, ""))
    .filter((word) => word !== "" && !SERVICE_WORDS.has(word) && !/^[\d.-]+$/u.test(word));
  while (kept.length > 0 && PREFIX_WORDS.has(kept[0] ?? "")) kept.shift();
  return { key: kept.join(" "), mcc };
}

/** Название для человека из ключа без справочника: «ТАКСИ СВОИ» → «Такси Свои». */
export function titleCase(key: string): string {
  return key
    .toLowerCase()
    .split(" ")
    .map((word) => (word === "" ? word : word[0]?.toUpperCase() + word.slice(1)))
    .join(" ");
}

/** Вес, объём, количество и жирность в наименовании: 900г, 0,5 кг, 1л, 3,2%, 10шт, 1,5 l. */
const MEASURE = /\d+(?:[.,]\d+)?\s*(?:%|кг|г|гр|мг|л|мл|шт|уп|kg|g|l|ml|pcs)(?=$|[\s.,;)/-])\.?/giu;

/** RCPT-15: «Молоко 3,2% 1л» → «Молоко»; «Бальзам для волос 200 мл» → «Бальзам для волос». */
export function normalizeItemName(name: string): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(MEASURE, " ")
    .replace(/[«»"'()[\]*]/gu, " ")
    .replace(/\s+[\d.,/-]+(?=\s|$)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[\s.,/-]+$/u, "");
  if (cleaned === "") return name.trim();
  return cleaned[0]?.toUpperCase() + cleaned.slice(1).toLowerCase();
}
