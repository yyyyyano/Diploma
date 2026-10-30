// LAW-30, LAW-32, LAW-34 на настоящих карточках Национального реестра (ПСМ № 778, Закон № 369-З; сохранены 2026-10-30) и
// странице 90-З: дата вступления, перечень изменяющих актов, ключи «номер|дата», перечень изменений, вошедших в текст.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { changeKeysOfPage, changesIn, parseCard } from "./parse-card.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../__fixtures__/pravo-by/${name}`, import.meta.url), "utf8");

describe("карточка акта pravo.by", () => {
  it("LAW-13: строка «вид акта, орган, дата и номер» читается как есть — по ней узнают орган", () => {
    expect(parseCard(fixture("card-H10800369.html")).kindLine).toBe(
      "Закон Республики Беларусь от 8 июля 2008 г. № 369-З",
    );
    expect(parseCard(fixture("card-C20200778.html")).kindLine).toContain(
      "Постановление Совета Министров",
    );
  });

  it("ПСМ № 778: название, дата вступления в силу, 7 изменяющих актов с ключами «номер|дата»", () => {
    const card = parseCard(fixture("card-C20200778.html"));
    expect(card.title).toContain("О мерах по реализации Закона");
    expect(card.inForceOn).toBe("2002-07-25");
    expect(card.repealedOn).toBeNull();
    expect(card.changes).toHaveLength(7);
    expect(card.changes[0]).toEqual({
      key: "26|2009-01-14",
      description: "Постановление Совета Министров Республики Беларусь от 14 января 2009 г. № 26",
    });
    expect(card.changes.at(-1)?.key).toBe("62|2022-02-02");
  });

  it("Закон № 369-З: пять изменяющих законов, у действующего акта даты утраты силы нет", () => {
    const card = parseCard(fixture("card-H10800369.html"));
    expect(card.inForceOn).toBe("2009-01-01");
    expect(card.changes.map((c) => c.key)).toEqual([
      "41-з|2009-07-14",
      "240-з|2015-01-10",
      "128-з|2021-11-11",
      "27-з|2024-07-08",
      "56-з|2013-07-12",
    ]);
  });

  it("«Дата ограничения действия» — акт утратил силу с этого дня (LAW-34)", () => {
    const html = fixture("card-C20200778.html").replace(
      "<b>Дата вступления в силу</b>",
      "<b>Дата ограничения действия</b><div>01.06.2025</div><b>Дата вступления в силу</b>",
    );
    expect(parseCard(html).repealedOn).toBe("2025-06-01");
  });

  it("перечень изменений на странице 90-З: последнее — Закон № 134-З от 16 марта 2026, оно уже в тексте", () => {
    const keys = changeKeysOfPage(fixture("H10200090.html"));
    expect(keys.has("134-з|2026-03-16")).toBe(true);
    expect(keys.has("183-з|2003-01-04")).toBe(true);
  });

  it("фразы без даты и неизвестный месяц пропускаются, повторы схлопываются", () => {
    const text =
      "Закон Республики Беларусь от 5 мартобря 2020 г. № 1-З; Закон от 5 января 2020 г. № 2-З; Закон от 5 января 2020 г. № 2-З; Закон без даты";
    expect(changesIn(text).map((c) => c.key)).toEqual(["2-з|2020-01-05"]);
  });
});
