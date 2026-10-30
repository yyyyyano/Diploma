// Точное обращение по реквизитам (LAW-21 шаг 1): «ст. 210 НК», «п. 3 ст. 13 Закона о защите прав потребителей» →
// акт по таблице кратких имён, статья и пункт — без векторов. Разбор — чистая функция; поиск по БД — application/search.
/** Нижний регистр, ё → е, всё кроме букв и цифр — пробел, пробелы схлопнуты: ключ алиаса и «хвоста» обращения. */
export function normalizeAlias(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}¹²³]+/gu, " ")
    .trim();
}

export interface ParsedReference {
  /** Ключ статьи как в БД: `210`, `216.1`. */
  readonly articleNo: string;
  /** Ключ пункта (`3`, `2.1`), если назван. */
  readonly point: string | null;
  /** Нормализованное название акта: «нк», «закона о защите прав потребителей». */
  readonly actAlias: string;
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

function numberKey(raw: string): string {
  let out = "";
  let sup = false;
  for (const ch of raw) {
    const at = SUPERSCRIPT.indexOf(ch);
    if (at >= 0) {
      if (!sup) out += ".";
      out += String(at);
      sup = true;
    } else {
      out += ch === " " ? "" : ch;
      sup = false;
    }
  }
  return out;
}

const REFERENCE =
  /^(?:(?:п|пункт\p{L}*|пп|подпункт\p{L}*)\s+(\d+(?:\s?[.¹²³]?\s?\d+)*)\s+)?(?:ст|статья|статьи|статье|статью|статьей|статьёй)\s+(\d+(?:[¹²³]|\s?\.\s?\d+)?)\s+(.+)$/u;

/** Разобрать обращение; не по форме «ст. N <акт>» — null (идём в гибридный поиск). */
export function parseReference(query: string): ParsedReference | null {
  // Точки внутри номеров («2.1», «216.1») нужны, прочие знаки — нет: сначала склеиваем «ст.» и номер.
  const cleaned = query
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/\s+/gu, " ")
    .replace(/(^|\s)(п|пп|ст)\.\s*/gu, "$1$2 ")
    .trim();
  const match = REFERENCE.exec(cleaned);
  if (match === null) return null;
  const actAlias = normalizeAlias(match[3] ?? "");
  if (actAlias === "") return null;
  return {
    articleNo: numberKey(match[2] ?? ""),
    point: match[1] === undefined ? null : numberKey(match[1]),
    actAlias,
  };
}
