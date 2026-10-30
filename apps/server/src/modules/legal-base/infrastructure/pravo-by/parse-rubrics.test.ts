// LAW-14: рубрики ЕПК на настоящей странице guid=11031 (90-З, сохранена 2026-10-31) и на видимой вёрстке с той же ссылкой.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRubrics } from "./parse-rubrics.ts";

describe("LAW-14: рубрики ЕПК карточки акта", () => {
  it("настоящая страница 90-З: рубрика 04.01.14 лежит в HTML-комментарии и всё равно находится", () => {
    const html = readFileSync(
      new URL("../../__fixtures__/pravo-by/rubrics-H10200090.html", import.meta.url),
      "utf8",
    );
    expect(parseRubrics(html)).toEqual(["04.01.14"]);
  });

  it("видимая вёрстка: ссылка на рубрику и название рядом; даты и номера рубриками не считаются", () => {
    const html = `<html><body><div><a href="/document/?guid=1991&amp;p0=04.01.14&amp;p2=0">04.01.14</a> Защита прав потребителей</div>
      <div><a href="/document/?guid=1991&amp;p0=08.03">08.03</a> Пособия</div>
      <p>Принят 15.07.2008 Законом</p><div>Номер 2/1466</div></body></html>`;
    expect(parseRubrics(html)).toEqual(["04.01.14", "08.03"]);
  });

  it("запасной признак: элемент с кодом и названием без ссылки; повторы не дублируются", () => {
    const html = `<html><body><ul><li>03.02 Налоговое право</li><li><span>03.02 Налоговое право</span></li></ul></body></html>`;
    expect(parseRubrics(html)).toEqual(["03.02"]);
  });

  it("страница без рубрик (переадресация на другую страницу) — пустой список", () => {
    expect(parseRubrics("<html><body><p>Национальный реестр</p></body></html>")).toEqual([]);
  });

  it("ссылка не на рубрики (другой guid) или с p0, не похожим на код, не принимается", () => {
    const html = `<html><body><a href="/document/?guid=3871&amp;p0=04.01.14">текст</a><a href="/document/?guid=1991&amp;p0=H10200090">акт</a></body></html>`;
    expect(parseRubrics(html)).toEqual([]);
  });
});
