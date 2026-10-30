// Запрос полнотекстового поиска (LAW-21 шаг 2, ADR-0007): слова вопроса и юридические термины словаря → строка для
// `to_tsquery('russian', …)`. Сначала «И» (точнее), при нехватке — «ИЛИ». В строку попадают только буквы и цифры:
// операторы ставит этот код, текст пользователя в запрос не вставляется.
import { normalizeAlias } from "./reference.ts";
import { COLLOQUIAL_TERMS } from "./synonyms.ts";

/** Служебные слова вопроса: поиску они мешают. */
const STOP = new Set([
  "и",
  "в",
  "во",
  "не",
  "на",
  "с",
  "со",
  "по",
  "для",
  "от",
  "до",
  "из",
  "за",
  "к",
  "о",
  "об",
  "а",
  "но",
  "или",
  "ли",
  "что",
  "как",
  "это",
  "я",
  "мне",
  "мой",
  "можно",
  "нужно",
  "если",
  "при",
  "ни",
  "то",
  "же",
  "бы",
  "у",
]);

function words(text: string): string[] {
  return normalizeAlias(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Группа «слово или его юридический термин»: `(зарплата | (заработная & плата))`. */
function group(word: string): string {
  const terms = (COLLOQUIAL_TERMS[word] ?? []).map((t) => `(${words(t).join(" & ")})`);
  return terms.length === 0 ? word : `(${[word, ...terms].join(" | ")})`;
}

export type TsMode = "and" | "or";

/** Строка запроса или null, если в вопросе нет значимых слов. */
export function buildTsQuery(question: string, mode: TsMode): string | null {
  const list = [...new Set(words(question))];
  if (list.length === 0) return null;
  return list.map(group).join(mode === "and" ? " & " : " | ");
}
