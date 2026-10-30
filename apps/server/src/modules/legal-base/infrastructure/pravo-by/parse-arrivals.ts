// Страница «Новые поступления» Национального реестра (LAW-12): акты, зарегистрированные за день. Разбор — по смыслу вёрстки
// (`dl` → `dt` с номером в реестре и датой, `dd p a` с названием и ссылкой, строка вида акта после `<br>`), не по классам.
// Число «Количество зарегистрированных правовых актов: N» на странице — канарейка: расхождение с разобранным — вёрстка изменилась.
import * as cheerio from "cheerio";
import { collapseSpaces } from "./read-page.ts";

export interface ArrivalEntry {
  /** ID на pravo.by из ссылки на карточку (`p0=`). */
  readonly pravoId: string;
  readonly title: string;
  /** «Постановление Министерства … Республики Беларусь от 13 октября 2026 г. № 33» — вид, орган, дата и номер. */
  readonly kindLine: string;
  /** Номер в Национальном реестре: `3-2/22715`; первое число — раздел реестра. */
  readonly registryNo: string | null;
}

export interface ParsedArrivals {
  readonly entries: readonly ArrivalEntry[];
  /** Сколько актов страница заявляет о себе; нет числа — null. */
  readonly declared: number | null;
}

export function parseArrivals(html: string): ParsedArrivals {
  const $ = cheerio.load(html);
  $("script, style").remove();
  const entries: ArrivalEntry[] = [];
  $("dl").each((_, dl) => {
    const link = $(dl).find("dd a[href*='p0=']").first();
    const href = link.attr("href") ?? "";
    const pravoId = /[?&]p0=([A-Za-z0-9]+)/u.exec(href)?.[1];
    const title = collapseSpaces(link.text());
    if (pravoId === undefined || title === "") return;
    const paragraph = link.closest("p");
    paragraph.find("a").remove();
    const registryNo = /\d{1,2}-\d+\s*\/\s*\d+/u.exec(collapseSpaces($(dl).find("dt").text()));
    entries.push({
      pravoId,
      title,
      kindLine: collapseSpaces(paragraph.text()),
      registryNo: registryNo === null ? null : registryNo[0].replace(/\s+/gu, ""),
    });
  });
  // Число читаем из самого элемента-счётчика: в общем тексте страницы оно могло бы слипнуться с соседним числом.
  let declared: number | null = null;
  $("body *").each((_, el) => {
    if (declared !== null || $(el).children().length > 0) return;
    const m = /Количество\s+зарегистрированных\s+правовых\s+актов:\s*(\d+)/u.exec(
      collapseSpaces($(el).text()),
    );
    if (m !== null) declared = Number(m[1]);
  });
  return { entries, declared };
}
