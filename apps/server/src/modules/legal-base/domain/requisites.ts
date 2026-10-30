// Реквизиты актов в тексте и перевод их в ID pravo.by (LAW-11, LAW-12): «Законом Республики Беларусь от 8 июля 2008 г.
// № 369-З» → H10800369. Правило проверено на стартовом каталоге: закон — `H1`+ГГ+номер из 5 цифр (до 1996 г., номер с
// римским суффиксом «-XII», — `V1`), указ — `P3`, ПСМ — `C2`, кодекс — `HK`/`Hk` (регистр второй буквы в каталоге разный,
// поэтому вариантов два). Ведомственные акты (приказы, постановления министерств) ID по реквизитам не получают — их ID
// строится из номера в Национальном реестре, а не из номера акта (research/legal-corpus-strategy.md §1.1): они не разрешаются.
export const MONTH_NUMBERS: Readonly<Record<string, string>> = {
  января: "01",
  февраля: "02",
  марта: "03",
  апреля: "04",
  мая: "05",
  июня: "06",
  июля: "07",
  августа: "08",
  сентября: "09",
  октября: "10",
  ноября: "11",
  декабря: "12",
};

export type RequisiteKind = "law" | "decree" | "resolution" | "code";

export interface Requisite {
  readonly kind: RequisiteKind;
  /** День принятия, ISO. */
  readonly day: string;
  /** Номер без суффикса: «369». */
  readonly number: string;
  /** Возможные ID на pravo.by (у кодекса — два написания). */
  readonly pravoIds: readonly string[];
}

/** «от 8 июля 2008 г. № 369-З»: день, месяц, год, номер, суффикс номера. */
const DATE_NUMBER =
  /от\s+(\d{1,2})\s+([а-яё]+)\s+(\d{4})\s*г(?:ода|\.)?\s*№\s*(\d+)(?:\s*-\s*([А-ЯЁA-Z]{1,5}))?/giu;

/** Слово вида акта перед реквизитами: ближайшее слева определяет, что за акт (ведомственные — «неразрешимые»). */
const KIND_WORD =
  /(?<![\p{L}])(постановлени\p{L}*\s+совета\s+министров|постановлени\p{L}*|закон(?:а|у|ом|е|ы|ов|ам|ами|ах)?|указ(?:а|у|ом|е|ы|ов|ам|ами|ах)?|кодекс(?:а|у|ом|е|ы|ов)?|декрет\p{L}*|приказ\p{L}*|решени\p{L}*|директив\p{L}*)(?![\p{L}])/giu;

/** Насколько далеко слева от даты ищется слово вида: «Закон Республики Беларусь «О …» от …» укладывается с запасом. */
const LOOKBACK = 220;

function kindOf(word: string): RequisiteKind | null {
  const w = word.toLowerCase();
  if (w.startsWith("постановлени")) return w.includes("совета министров") ? "resolution" : null;
  if (w.startsWith("закон")) return "law";
  if (w.startsWith("указ")) return "decree";
  if (w.startsWith("кодекс")) return "code";
  return null;
}

function idsOf(kind: RequisiteKind, year: string, number: string, suffix: string): string[] {
  const yy = year.slice(2);
  const nn = number.padStart(5, "0");
  switch (kind) {
    case "law":
      // Римский суффикс («-XII») — законы до 1996 г.: V1…; «-З» и без суффикса — H1….
      return [`${/^[IVXL]+$/u.test(suffix) ? "V1" : "H1"}${yy}${nn}`];
    case "decree":
      return [`P3${yy}${nn}`];
    case "resolution":
      return [`C2${yy}${nn}`];
    case "code":
      return [`HK${yy}${nn}`, `Hk${yy}${nn}`];
  }
}

/**
 * Все реквизиты в тексте, которые переводятся в ID pravo.by, без повторов, в порядке появления. «Постановлений Совета
 * Министров … от 27 июня 2017 г. № 483 и от 28 июня 2023 г. № 416» даёт оба: вид берётся по ближайшему слову слева.
 */
export function requisitesIn(text: string): Requisite[] {
  const found = new Map<string, Requisite>();
  for (const m of text.matchAll(DATE_NUMBER)) {
    const month = MONTH_NUMBERS[(m[2] ?? "").toLowerCase()];
    if (month === undefined || m.index === undefined) continue;
    const before = text.slice(Math.max(0, m.index - LOOKBACK), m.index);
    const word = [...before.matchAll(KIND_WORD)].at(-1)?.[1];
    const kind = word === undefined ? null : kindOf(word);
    if (kind === null) continue;
    const ids = idsOf(kind, m[3] ?? "", m[4] ?? "", (m[5] ?? "").toUpperCase());
    const key = ids[0] ?? "";
    if (!found.has(key)) {
      found.set(key, {
        kind,
        day: `${m[3] ?? ""}-${month}-${(m[1] ?? "").padStart(2, "0")}`,
        number: m[4] ?? "",
        pravoIds: ids,
      });
    }
  }
  return [...found.values()];
}
