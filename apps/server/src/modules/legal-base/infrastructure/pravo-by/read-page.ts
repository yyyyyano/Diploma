// Чтение страницы акта pravo.by (LAW-20, ADR-0012): cheerio превращает HTML в абзацы с классом вёрстки и видимым
// текстом — дальше режет domain/build-fragments.ts. Надстрочные цифры (`20<sup>1</sup>`) переводятся в знаки Юникода
// («20¹»), иначе номер статьи 20¹ слился бы со статьёй 201 (ADR-0007, ключ 216.1). Скрипты и стили в текст не идут.
import * as cheerio from "cheerio";
import type { RawParagraph } from "../../domain/build-fragments.ts";

export interface ReadPage {
  /** Заголовок акта: `p.titlek`, `h1` или `<title>` — пусто, если страница не похожа на акт (LAW-39). */
  readonly title: string;
  readonly paragraphs: readonly RawParagraph[];
  /** Весь видимый текст — для проверки кодировки. */
  readonly pageText: string;
}

const SUPERSCRIPT = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

/** Пробелы, неразрывные пробелы и переводы строк — в один пробел; края обрезаются. */
export function collapseSpaces(text: string): string {
  return text.replace(/[\s ]+/gu, " ").trim();
}

export function readActPage(html: string): ReadPage {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  $("sup").each((_, el) => {
    const digits = $(el).text().replace(/\D/gu, "");
    $(el).replaceWith(
      digits
        .split("")
        .map((d) => SUPERSCRIPT[Number(d)] ?? d)
        .join(""),
    );
  });
  const paragraphs: RawParagraph[] = [];
  $("body p, p").each((_, el) => {
    // Выбор `body p, p` не дублирует узлы: cheerio отдаёт каждый элемент один раз в порядке документа.
    const text = collapseSpaces($(el).text());
    if (text !== "")
      paragraphs.push({ cls: ($(el).attr("class") ?? "").split(/\s+/u)[0] ?? "", text });
  });
  const title =
    collapseSpaces($("p.titlek").first().text()) ||
    collapseSpaces($("h1").first().text()) ||
    collapseSpaces($("title").first().text());
  return { title, paragraphs, pageText: collapseSpaces($.root().text()) };
}
