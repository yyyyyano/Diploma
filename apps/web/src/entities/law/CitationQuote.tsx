// Дословная цитата нормы из правового ответа (CHAT-05, DES-12, LEGAL-03, LEGAL-05): шапка «акт, статья, пункт», текст
// шрифтом законов, «в редакции на …» и ссылка на pravo.by. Текст версии подставила программа и проверила дословность —
// компонент ничего не меняет (P3). Предупреждение (изменённая статья, принятые изменения) — одной строкой под цитатой.
import type { LawCitationData } from "@kosht/contract";
import { LawQuote } from "../../ui/index.ts";

export type QuoteCitation = Extract<LawCitationData, { readonly kind: "quote" }>;
export type LinkCitation = Extract<LawCitationData, { readonly kind: "link" }>;

/** «НК (Особенная часть), ст. 209, п. 1.1»: акт и подпись нормы; без подписи — путь по структуре акта. */
export function citationSource(citation: QuoteCitation | LinkCitation): string {
  const where = citation.kind === "quote" ? (citation.label ?? citation.path) : citation.label;
  return where === null || where === "" ? citation.actTitle : `${citation.actTitle}, ${where}`;
}

/** Короткая подпись чипа: «ст. 209, п. 1.1»; нет подписи — название акта. */
export function citationChipLabel(citation: QuoteCitation | LinkCitation): string {
  return citation.label === null || citation.label === "" ? citation.actTitle : citation.label;
}

export interface CitationQuoteProps {
  readonly citation: QuoteCitation;
  /** Предупреждение под цитатой; без него — только заметки версии (`notes`). */
  readonly warning?: string | undefined;
}

export function CitationQuote({ citation, warning }: CitationQuoteProps) {
  const notes = citation.notes.join(" ");
  const shown = [warning, notes === "" ? undefined : notes].filter(
    (part): part is string => part !== undefined,
  );
  return (
    <LawQuote
      source={citationSource(citation)}
      href={citation.url}
      edition={citation.edition}
      {...(shown.length === 0 ? {} : { warning: shown.join(" ") })}
    >
      {citation.text}
    </LawQuote>
  );
}
