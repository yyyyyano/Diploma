// Склонённый словарь имён (PRIV-03): имена пользователя из профиля («Сергей Иванов», «Анна») ловятся во всех падежах —
// «Сергея», «Ивановой», «Анну». Морфологии нет: у слова берётся основа (без конечной гласной, «й» или «ь»), а за ней
// допускается до трёх букв окончания. Слово короче четырёх букв — только как есть. Регистр не важен («ИВАНОВ»).
// Лишние срабатывания («роман» при имени Роман) дешевле утечки имени, поэтому правило щедрое.
import type { Span } from "./rules.ts";

const ENDINGS = /[аяйьеоиыуюёэ]$/u;
const MAX_ENDING = 3;
const MIN_STEM_FOR_ENDINGS = 3;

function stemOf(word: string): { stem: string; inflects: boolean } {
  const stem = word.replace(ENDINGS, "");
  return stem.length >= MIN_STEM_FOR_ENDINGS
    ? { stem, inflects: true }
    : { stem: word, inflects: false };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Слова имён: без инициалов и однобуквенных кусков; дефисные имена — по частям. */
function wordsOf(names: readonly string[]): string[] {
  const words = names.flatMap((name) => name.split(/[\s\-.,]+/u)).map((word) => word.trim());
  return [...new Set(words.filter((word) => word.length >= 2).map((word) => word.toLowerCase()))];
}

/** Матчер имён пользователя; имён нет — undefined. */
export function nameMatcher(names: readonly string[]): ((text: string) => Span[]) | undefined {
  const words = wordsOf(names);
  if (words.length === 0) return undefined;
  const alternatives = words.map((word) => {
    const { stem, inflects } = stemOf(word);
    return inflects ? `${escape(stem)}[а-яёa-z]{0,${String(MAX_ENDING)}}` : escape(stem);
  });
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  return (text) =>
    [...text.matchAll(pattern)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      kind: "name" as const,
    }));
}
