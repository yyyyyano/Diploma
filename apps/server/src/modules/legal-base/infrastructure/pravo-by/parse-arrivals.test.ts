// LAW-12 на настоящей странице «Новые поступления» за 29.10.2026 (сохранена 2026-10-30): разбор и канарейка.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseArrivals } from "./parse-arrivals.ts";

const html = readFileSync(
  new URL("../../__fixtures__/pravo-by/novye-postupleniya.html", import.meta.url),
  "utf8",
);

describe("LAW-12: страница «Новые поступления»", () => {
  const { entries, declared } = parseArrivals(html);

  it("число разобранных актов совпадает с заявленным страницей (канарейка вёрстки)", () => {
    expect(declared).toBe(34);
    expect(entries).toHaveLength(34);
  });

  it("указ: ID из ссылки, название, строка вида акта и раздел реестра", () => {
    expect(entries.find((e) => e.pravoId === "P32600393")).toEqual({
      pravoId: "P32600393",
      title: "О торговле маркированными ювелирными изделиями",
      kindLine: "Указ Президента Республики Беларусь от 29 октября 2026 г. № 393",
      registryNo: "3-2/22716",
    });
  });

  it("министерский акт: орган остаётся в строке вида", () => {
    const entry = entries.find((e) => e.pravoId === "W22645392");
    expect(entry?.kindLine).toContain("Министерства природных ресурсов и охраны окружающей среды");
  });

  it("местные акты видны по ID и разделу реестра", () => {
    const local = entries.filter((e) => /^[DR]9/u.test(e.pravoId));
    expect(local).toHaveLength(26);
    expect(local.every((e) => Number(e.registryNo?.split("-")[0]) >= 15)).toBe(true);
  });

  it("число актов читается из своего элемента, даже если рядом без пробела стоит другое число", () => {
    const html =
      '<body><p>Количество зарегистрированных правовых актов: 1</p><dl><dt>6-2/56393<br/>(29.10.2026)</dt><dd><p><a href="/document/?guid=3961&amp;p0=C22600551">Название</a><br/>Постановление</p></dd></dl></body>';
    expect(parseArrivals(html).declared).toBe(1);
  });

  it("страница иной вёрстки даёт пустой разбор без числа — вызывающий это замечает", () => {
    expect(parseArrivals("<html><body><p>Технические работы</p></body></html>")).toEqual({
      entries: [],
      declared: null,
    });
  });
});
