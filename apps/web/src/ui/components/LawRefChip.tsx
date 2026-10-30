// Ссылка на норму (DES-06, design/DESIGN.md §4): «ст. 210 НК» — чип со значком закона; со ссылкой — настоящая `<a>`,
// внешняя (pravo.by) открывается в новой вкладке. Подпись всегда текстом: смысл не держится на одном цвете (NFR-20).
import { ExternalLink, Scale } from "lucide-react";
import classes from "./LawRefChip.module.css";

export interface LawRefChipProps {
  /** «ст. 210 НК» — готовая подпись. */
  readonly label: string;
  readonly href?: string;
  /** Ссылка ведёт на другой сайт (pravo.by): новая вкладка, `rel="noopener noreferrer"`, значок «внешняя». */
  readonly external?: boolean;
}

export function LawRefChip({ label, href, external = false }: LawRefChipProps) {
  const content = (
    <>
      <Scale size={14} strokeWidth={1.8} aria-hidden />
      {label}
      {external && <ExternalLink size={12} strokeWidth={1.8} aria-hidden />}
    </>
  );
  if (href === undefined) return <span className={classes.chip}>{content}</span>;
  return (
    <a
      className={classes.chip}
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {content}
    </a>
  );
}
