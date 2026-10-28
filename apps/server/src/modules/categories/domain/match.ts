// Глобальные правила категоризации (CAT-03, CAT-04, CAT-07) — чистые функции: ключевое слово в описании или в
// наименовании позиции (начало слова, побеждает самое длинное совпадение), MCC. Правило подходит, только если тип его
// категории совпадает с типом операции (расход или доход).

export interface GlobalRule {
  readonly matcher: "keyword" | "item" | "mcc";
  readonly pattern: string;
  readonly categoryCode: string;
}

const LETTER = /[\p{L}\p{N}]/u;

/** Слово начинается с шаблона: «СОК» есть в «СОК ЯБЛОЧНЫЙ», но не в «ПЕСОК». */
function startsWord(text: string, pattern: string): boolean {
  for (let at = text.indexOf(pattern); at !== -1; at = text.indexOf(pattern, at + 1)) {
    if (at === 0 || !LETTER.test(text[at - 1] ?? "")) return true;
  }
  return false;
}

/** Самое длинное правило вида `matcher`, чей шаблон начинает слово в одном из текстов (тексты — в верхнем регистре). */
export function matchText(
  texts: readonly string[],
  rules: readonly GlobalRule[],
  matcher: "keyword" | "item",
  allowed: (code: string) => boolean,
): GlobalRule | undefined {
  let best: GlobalRule | undefined;
  for (const rule of rules) {
    if (rule.matcher !== matcher || !allowed(rule.categoryCode)) continue;
    if (best !== undefined && rule.pattern.length <= best.pattern.length) continue;
    if (texts.some((text) => startsWord(text, rule.pattern))) best = rule;
  }
  return best;
}

/** Правило по коду MCC (CAT-03: на MCC в выписках РБ полагаться нельзя — он последний из правил). */
export function matchMcc(
  mcc: string | null | undefined,
  rules: readonly GlobalRule[],
  allowed: (code: string) => boolean,
): GlobalRule | undefined {
  if (mcc === null || mcc === undefined) return undefined;
  return rules.find(
    (rule) => rule.matcher === "mcc" && rule.pattern === mcc && allowed(rule.categoryCode),
  );
}
