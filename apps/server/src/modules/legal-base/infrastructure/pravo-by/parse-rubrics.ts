// Рубрики Единого правового классификатора (ЕПК) на странице `guid=11031` (LAW-14). На настоящей странице (90-З, сохранена
// 2026-10-31) рубрика — ссылка `<a href="/document/?guid=1991&p0=04.01.14">04.01.14</a>` и название рядом, причём весь блок «Рубрики
// документа» лежит внутри HTML-комментария: сайт его не показывает, но отдаёт. Поэтому читаем и видимые элементы, и содержимое
// комментариев: ссылка на рубрику — главный признак, запасной — элемент без вложенных, текст которого начинается с кода и названия.
// Если сайт уберёт блок совсем — рубрик нет, и акт с текстом уходит в «предложенные» (LAW-14), а не в индекс.
// Страница есть только у актов из тематических банков данных; у остальных сайт отвечает переадресацией.
import * as cheerio from "cheerio";
import { collapseSpaces } from "./read-page.ts";

const CODE = /^\d{2}(?:\.\d{2}){0,3}$/u;
const TITLED = /^(\d{2}(?:\.\d{2}){0,3})\s+\p{Lu}/u;

function collect(html: string, into: Set<string>): void {
  const $ = cheerio.load(html);
  $("script, style").remove();
  $("a[href]").each((_, el) => {
    let url: URL;
    try {
      url = new URL($(el).attr("href") ?? "", "https://pravo.by");
    } catch {
      return;
    }
    const code = url.searchParams.get("p0");
    if (url.searchParams.get("guid") === "1991" && code !== null && CODE.test(code)) {
      into.add(code);
    }
  });
  $("body *").each((_, el) => {
    if ($(el).children().length > 0) return;
    const code = TITLED.exec(collapseSpaces($(el).text()))?.[1];
    if (code !== undefined) into.add(code);
  });
}

/** Коды рубрик страницы в порядке появления, без повторов; не нашлось ни одной — пустой список. */
export function parseRubrics(html: string): string[] {
  const found = new Set<string>();
  collect(html, found);
  const $ = cheerio.load(html);
  $("*")
    .contents()
    .each((_, node) => {
      if (node.type === "comment") collect(node.data, found);
    });
  return [...found];
}
