// LAW-11: ссылки в тексте актов переводятся в ID pravo.by по правилу реквизитов (проверено на ID стартового каталога).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readActPage } from "../infrastructure/pravo-by/read-page.ts";
import { requisitesIn } from "./requisites.ts";

describe("LAW-11: реквизиты → ID pravo.by", () => {
  it.each([
    [
      "Законом Республики Беларусь от 8 июля 2008 г. № 369-З «О гарантированном возмещении…»",
      "H10800369",
    ],
    ["Указом Президента Республики Беларусь от 18 сентября 2019 г. № 345", "P31900345"],
    ["постановлением Совета Министров Республики Беларусь от 28 июня 2013 г. № 569", "C21300569"],
    [
      "Законом Республики Беларусь от 17 апреля 1992 г. № 1596-XII «О пенсионном обеспечении»",
      "V19201596",
    ],
    ["Законом Республики Беларусь от 18 июня 1993 г. № 2435-XII", "V19302435"],
  ])("«%s» → %s", (text, id) => {
    expect(requisitesIn(text).map((r) => r.pravoIds[0])).toEqual([id]);
  });

  it("кодекс даёт оба написания ID: регистр второй буквы в каталоге разный", () => {
    const [r] = requisitesIn("Кодексом Республики Беларусь от 7 января 2012 г. № 428-З");
    expect(r?.pravoIds).toEqual(["HK1200428", "Hk1200428"]);
  });

  it("два номера через «и» берут вид слева: оба постановления Совета Министров", () => {
    const text =
      "Об изменении постановлений Совета Министров Республики Беларусь от 27 июня 2017 г. № 483 и от 28 июня 2023 г. № 416";
    expect(requisitesIn(text).map((r) => r.pravoIds[0])).toEqual(["C21700483", "C22300416"]);
  });

  it("постановление министерства и приказ не разрешаются: их ID по номеру акта не строится", () => {
    expect(
      requisitesIn(
        "постановлением Министерства финансов Республики Беларусь от 2 февраля 2022 г. № 5, приказом Минтруда от 3 марта 2021 г. № 9",
      ),
    ).toEqual([]);
  });

  it("слово «законодательство» не принимается за вид акта", () => {
    expect(requisitesIn("законодательство от 1 мая 2020 г. № 7")).toEqual([]);
  });

  it("повторная ссылка на тот же акт не дублируется", () => {
    const text = "Законом от 8 июля 2008 г. № 369-З и снова Законом от 8 июля 2008 г. № 369-З";
    expect(requisitesIn(text)).toHaveLength(1);
  });

  it("настоящий текст ПСМ № 569: находит Закон о государственных пособиях из стартового каталога, без повторов", () => {
    const html = readFileSync(
      new URL("../__fixtures__/pravo-by/C21300569.html", import.meta.url),
      "utf8",
    );
    const text = readActPage(html)
      .paragraphs.filter((p) => p.cls !== "changeadd")
      .map((p) => p.text)
      .join("\n");
    const ids = requisitesIn(text).map((r) => r.pravoIds[0]);
    expect(ids).toContain("H11200007");
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(H1|V1|P3|C2|HK)\d{7}$/u);
  });
});
