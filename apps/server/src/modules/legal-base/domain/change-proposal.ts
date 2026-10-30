// Изменяющий акт (LAW-32): модель предлагает, какие статьи акта он меняет и когда вступает в силу, а программа принимает
// предложение, только если статьи и дата ДОСЛОВНО есть в тексте изменяющего акта (P3: модель текста права не выдумывает).
import { z } from "zod";
import { requisitesIn } from "./requisites.ts";

export const ChangeProposal = z.object({
  /** Номера статей изменяемого акта: «209», «216.1». */
  articles: z.array(z.string().max(20)).max(40),
  /** День вступления в силу, ISO `2026-07-01`; null — в тексте не названо. */
  inForceOn: z.string().nullable(),
});
export type ChangeProposal = z.infer<typeof ChangeProposal>;

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** Даты в тексте: «1 июля 2026» и «01.07.2026» — ISO-ключи всех найденных. */
function datesIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/giu)) {
    const month = MONTHS_GENITIVE.indexOf((m[2] ?? "").toLowerCase());
    if (month >= 0) {
      found.add(
        `${m[3] ?? ""}-${String(month + 1).padStart(2, "0")}-${(m[1] ?? "").padStart(2, "0")}`,
      );
    }
  }
  for (const m of text.matchAll(/(\d{2})\.(\d{2})\.(\d{4})/gu)) {
    found.add(`${m[3] ?? ""}-${m[2] ?? ""}-${m[1] ?? ""}`);
  }
  return found;
}

/** Номера статей, которые текст называет: «статьи 209 и 210», «ст. 216¹»; ключ с точкой. */
function articlesIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:стат\p{L}*|ст\.)\s*(\d[\d¹²³.,\sи]*)/giu)) {
    for (const n of (m[1] ?? "").matchAll(/\d+(?:[¹²³]|\.\d+)?/gu)) {
      found.add(n[0].replace(/[¹²³]/u, (c) => `.${String("¹²³".indexOf(c) + 1)}`));
    }
  }
  return found;
}

/** Принять из предложения только то, что дословно есть в тексте изменяющего акта. */
export function verifyProposal(
  proposal: ChangeProposal,
  text: string,
): { articles: string[]; inForceOn: string | null } {
  const named = articlesIn(text);
  const articles = [...new Set(proposal.articles.map((a) => a.trim()))].filter((a) => named.has(a));
  const inForceOn =
    proposal.inForceOn !== null && datesIn(text).has(proposal.inForceOn)
      ? proposal.inForceOn
      : null;
  return { articles, inForceOn };
}

/** ID изменяющего акта на pravo.by по правилу реквизитов (LAW-11): Закон № 134-З 2026 → H12600134; иное — null. */
export function pravoIdOf(description: string): string | null {
  return requisitesIn(description)[0]?.pravoIds[0] ?? null;
}
