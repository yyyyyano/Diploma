// Рубрики Единого правового классификатора (ЕПК) на странице `guid=11031` (LAW-14): «04.01.14 Защита прав потребителей».
// Читаем по смыслу, а не по классам: элемент без вложенных элементов, текст которого начинается с кода рубрики
// (`NN`, `NN.NN`, `NN.NN.NN`…) и названия с заглавной буквы. Даты («15.07.2008») коду не равны: после них нет пробела и названия.
// Страница есть только у актов из тематических банков данных; у остальных сайт отвечает переадресацией — рубрик нет.
import * as cheerio from "cheerio";
import { collapseSpaces } from "./read-page.ts";

const RUBRIC = /^(\d{2}(?:\.\d{2}){0,3})\s+\p{Lu}/u;

/** Коды рубрик страницы в порядке появления, без повторов; не нашлось ни одной — пустой список. */
export function parseRubrics(html: string): string[] {
  const $ = cheerio.load(html);
  $("script, style").remove();
  const found = new Set<string>();
  $("body *").each((_, el) => {
    if ($(el).children().length > 0) return;
    const code = RUBRIC.exec(collapseSpaces($(el).text()))?.[1];
    if (code !== undefined) found.add(code);
  });
  return [...found];
}
