// Страница акта pravo.by → фрагменты (LAW-20): чтение cheerio + разрез по правилам domain.
import { buildFragments, type ParsedAct } from "../../domain/build-fragments.ts";
import { readActPage } from "./read-page.ts";

export interface ParsedPage {
  readonly title: string;
  readonly parsed: ParsedAct;
  readonly pageText: string;
}

/** `label` — как акт назван в пути поиска («НК (Особенная часть)»). */
export function parseActPage(html: string, label: string): ParsedPage {
  const page = readActPage(html);
  return {
    title: page.title,
    parsed: buildFragments(page.paragraphs, { label }),
    pageText: page.pageText,
  };
}
