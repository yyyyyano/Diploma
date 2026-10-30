// LAW-15: ссылки на pravo.by со страниц ведомственных сайтов — только ID актов, текст с сайта органа не берётся (LAW-03).
import { describe, expect, it } from "vitest";
import { pravoLinksIn } from "./parse-links.ts";

describe("LAW-15: ссылки на акты со страницы ведомства", () => {
  const html = `<a href="https://pravo.by/document/?guid=3871&p0=H10200090">Закон</a>
    <a href="//www.pravo.by/document/?guid=12551&amp;p0=P32500108">Указ</a>
    <a href="/document/?guid=3961&p0=C21300569">относительная</a>
    <a href="https://etalonline.by/document/?regnum=H11200007">etalon</a>
    <a href="https://pravo.by/novosti/">новости</a>
    <a href="https://pravo.by/document/?guid=3871&p0=H10200090">повтор</a>
    <a href="http://[bad">битая</a>`;

  it("берёт ID с pravo.by (в том числе с www), без повторов; относительная ссылка на сайте ведомства — не pravo.by", () => {
    expect(pravoLinksIn(html, "https://www.nalog.gov.by/ru/zakon/")).toEqual([
      "H10200090",
      "P32500108",
    ]);
  });

  it("относительная ссылка считается ссылкой на pravo.by, только если сама страница с pravo.by", () => {
    expect(pravoLinksIn(html, "https://pravo.by/page/")).toContain("C21300569");
  });
});
