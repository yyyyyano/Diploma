// LAW-40: проверка строк справочников — одна на семь редакторов.
import { describe, expect, it } from "vitest";
import { checkValues, keyOf, parseTerms } from "./dictionaries.ts";

describe("LAW-40: строка справочника", () => {
  it("краткое имя нормализуется (регистр, ё, знаки), ключ строки — акт и имя", () => {
    const checked = checkValues("aliases", {
      pravoId: "Hk0900071",
      alias: "  Налоговый Кодекс, ёлка ",
    });
    expect(checked).toEqual({
      ok: true,
      values: { pravoId: "Hk0900071", alias: "налоговый кодекс елка" },
    });
    expect(keyOf("aliases", { pravoId: "Hk0900071", alias: "нк" })).toBe("Hk0900071|нк");
  });

  it("шаблон с ошибкой в регулярном выражении отклоняется на поле «pattern»", () => {
    expect(checkValues("title-patterns", { pattern: "^О (назначении" })).toEqual({
      ok: false,
      invalid: { field: "pattern", reason: "format" },
    });
    expect(checkValues("organs", { pattern: "[", topic: "taxes" })).toMatchObject({ ok: false });
  });

  it("тема вне десяти и пустое обязательное поле отклоняются с названием поля", () => {
    expect(checkValues("organs", { pattern: "банк", topic: "weather" })).toEqual({
      ok: false,
      invalid: { field: "topic", reason: "format" },
    });
    expect(checkValues("epk-topics", { rubric: "", topic: "taxes" })).toEqual({
      ok: false,
      invalid: { field: "rubric", reason: "required" },
    });
  });

  it("рубрика ЕПК — числа через точку; ID акта — по форме pravo.by", () => {
    expect(checkValues("epk-topics", { rubric: "04.01.14", topic: "consumer" })).toMatchObject({
      ok: true,
    });
    expect(checkValues("epk-topics", { rubric: "04-01", topic: "consumer" })).toMatchObject({
      ok: false,
    });
    expect(
      checkValues("start-catalog", {
        pravoId: "не-id",
        title: "Закон",
        label: "Закон",
        kind: "law",
        hasText: "text",
        group: "",
      }),
    ).toEqual({ ok: false, invalid: { field: "pravoId", reason: "format" } });
  });

  it("группа витрины у акта необязательна, но только из списка", () => {
    const base = { pravoId: "H10200090", title: "З", label: "З", kind: "law", hasText: "text" };
    expect(checkValues("start-catalog", { ...base, group: "" })).toMatchObject({ ok: true });
    expect(checkValues("start-catalog", { ...base, group: "privacy" })).toMatchObject({ ok: true });
    expect(checkValues("start-catalog", { ...base, group: "weather" })).toMatchObject({
      ok: false,
    });
  });

  it("слово словаря «бытовое → юридическое» — одно слово, термины через «;» без повторов", () => {
    expect(
      checkValues("colloquial", {
        word: "Зарплата",
        terms: "заработная плата; заработная плата; оплата труда",
      }),
    ).toEqual({
      ok: true,
      values: { word: "зарплата", terms: "заработная плата; оплата труда" },
    });
    expect(checkValues("colloquial", { word: "две слова", terms: "х" })).toMatchObject({
      ok: false,
    });
    expect(checkValues("colloquial", { word: "слово", terms: " ; " })).toMatchObject({ ok: false });
    expect(parseTerms("а;\nб; а")).toEqual(["а", "б"]);
  });

  it("адрес ведомственной страницы — только http и https", () => {
    expect(
      checkValues("agency-pages", { url: "https://www.mintrud.gov.by/ru/news" }),
    ).toMatchObject({ ok: true });
    expect(checkValues("agency-pages", { url: "javascript:alert(1)" })).toMatchObject({
      ok: false,
    });
    expect(checkValues("agency-pages", { url: "не адрес" })).toMatchObject({ ok: false });
  });

  it("слишком длинное значение отклоняется", () => {
    expect(checkValues("title-patterns", { pattern: "а".repeat(501) })).toEqual({
      ok: false,
      invalid: { field: "pattern", reason: "too-long" },
    });
  });
});
