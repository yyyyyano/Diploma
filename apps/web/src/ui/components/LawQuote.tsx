// Дословная цитата нормы (DES-12, LEGAL-02, design/DESIGN.md §4): текст шрифтом законов (Literata), источник и редакция —
// подписью под ней, предупреждение о принятых изменениях — отдельной строкой. Цитата — только то, что есть в тексте
// акта: сам компонент текст не меняет (P3).
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { LawRefChip } from "./LawRefChip.tsx";
import classes from "./LawQuote.module.css";

export interface LawQuoteProps {
  /** Дословный текст нормы. */
  readonly children: ReactNode;
  /** «НК (Особенная часть), ст. 210, п. 1». */
  readonly source: string;
  /** Ссылка на первоисточник (pravo.by). */
  readonly href?: string;
  /** «Редакция по состоянию на 21.10.2026». */
  readonly edition?: string;
  /** «Есть принятые изменения: …» — когда акт изменён, а изменения в текст ещё не вошли (LAW-32). */
  readonly warning?: string;
}

export function LawQuote({ children, source, href, edition, warning }: LawQuoteProps) {
  return (
    <figure className={classes.quote}>
      <blockquote className={classes.text}>{children}</blockquote>
      <figcaption className={classes.caption}>
        <LawRefChip label={source} {...(href === undefined ? {} : { href, external: true })} />
        {edition !== undefined && <span className={classes.edition}>{edition}</span>}
      </figcaption>
      {warning !== undefined && (
        <p className={classes.warning}>
          <TriangleAlert size={14} strokeWidth={1.8} aria-hidden />
          {warning}
        </p>
      )}
    </figure>
  );
}
