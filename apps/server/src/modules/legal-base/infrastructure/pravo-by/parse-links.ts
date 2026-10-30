// Ссылки на акты pravo.by со страниц ведомственных сайтов (LAW-15): текст актов с этих сайтов не берётся (LAW-03), нужен
// только ID акта из ссылки вида `https://pravo.by/document/?guid=3871&p0=H10200090`. Ссылки на etalonline, PDF и прочее
// игнорируются; относительные адреса разрешаются относительно страницы.
import * as cheerio from "cheerio";

const PRAVO_ID = /^[A-Za-z][A-Za-z0-9]{5,11}$/u;

/** ID актов из ссылок страницы `pageUrl` на pravo.by (адрес документа и параметр `p0`), без повторов. */
export function pravoLinksIn(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const found = new Set<string>();
  $("a[href]").each((_, el) => {
    let url: URL;
    try {
      url = new URL($(el).attr("href") ?? "", pageUrl);
    } catch {
      return;
    }
    const host = url.hostname.replace(/^www\./u, "");
    const id = url.searchParams.get("p0");
    if (
      host === "pravo.by" &&
      url.pathname.startsWith("/document") &&
      id !== null &&
      PRAVO_ID.test(id)
    ) {
      found.add(id);
    }
  });
  return [...found];
}
