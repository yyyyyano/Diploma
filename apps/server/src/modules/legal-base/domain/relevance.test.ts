// LAW-13: дешёвые фильтры без модели; LAW-12: изменяющий акт — не запись каталога; LAW-14: тема по рубрикам ЕПК.
import { describe, expect, it } from "vitest";
import { DEFAULT_TITLE_PATTERNS, isAmendingTitle, prefilter } from "./relevance.ts";
import { DEFAULT_EPK_TOPICS, topicOfOrgan, topicOfRubrics, topicOfTitle } from "./topics.ts";

const check = (title: string, pravoId = "P32600400", registryNo: string | null = "3-2/22715") =>
  prefilter({ pravoId, title, registryNo }, DEFAULT_TITLE_PATTERNS);

describe("LAW-13: фильтры без модели", () => {
  it("кадровый указ «О Сурове В.А.» отсекается шаблоном заголовка", () => {
    expect(check("О Сурове В.А.")).toMatchObject({ reason: "title-pattern" });
  });
  it.each([
    "О назначении Иванова И.И. судьёй",
    "Об освобождении Р.В.Пыжа от занимаемой должности",
    "О награждении государственными наградами",
    "Об изменении границ сельских населенных пунктов Минского района Минской области",
    "О предоставлении полномочий",
  ])("«%s» — разовый или кадровый акт", (title) => {
    expect(check(title)).toMatchObject({ reason: "title-pattern" });
  });

  it("местные акты отсекаются по префиксу ID и по разделу реестра", () => {
    expect(check("О мерах социальной поддержки", "D926g0148285", "17-1/148285")).toEqual({
      reason: "local",
    });
    expect(check("О мерах социальной поддержки", "P32600400", "16-2/148283")).toEqual({
      reason: "local",
    });
  });

  it("нужный акт ни одним фильтром не отсекается", () => {
    expect(check("О торговле маркированными ювелирными изделиями")).toBeNull();
    expect(check("О государственных пособиях семьям, воспитывающим детей")).toBeNull();
  });

  it("шаблон администратора с ошибкой в записи не ломает проход, остальные работают", () => {
    expect(
      prefilter({ pravoId: "P32600400", title: "О назначении", registryNo: null }, [
        "(не закрыта",
        "^О назначении",
      ]),
    ).toMatchObject({ reason: "title-pattern", pattern: "^О назначении" });
  });

  it.each([
    "Об изменении Указа Президента Республики Беларусь по вопросам строительства",
    "О внесении изменений и дополнений в некоторые законы",
    "О внесении дополнений и изменений в Закон Республики Беларусь",
    "О признании утратившими силу нормативных правовых актов",
    "Об изменении постановлений Совета Министров Республики Беларусь",
    "Об изменении и дополнении",
  ])("изменяющий акт «%s» не становится записью каталога", (title) => {
    expect(isAmendingTitle(title)).toBe(true);
    expect(check(title)).toEqual({ reason: "amending" });
  });

  it.each(["О торговле маркированными ювелирными изделиями", "Об утверждении перечня"])(
    "«%s» — не изменяющий акт",
    (title) => {
      expect(isAmendingTitle(title)).toBe(false);
    },
  );
});

describe("LAW-14: тема акта", () => {
  it.each([
    [["04.01.14"], "consumer"],
    [["08.03.01", "08.03.02"], "benefits"],
    [["03.02.01"], "taxes"],
    [["07.01"], "housing"],
    [["10.01.19"], "education-health"],
    [["18.01"], null],
    [["030.2"], null],
  ])("рубрики %j → %s", (codes, topic) => {
    expect(topicOfRubrics(codes, DEFAULT_EPK_TOPICS)).toBe(topic);
  });

  it("самое длинное совпадение побеждает: 04.07.02 — жильё, а не общая рубрика", () => {
    expect(topicOfRubrics(["04.07.02"], { "04": "fines", "04.07.02": "housing" })).toBe("housing");
  });

  it("орган из словаря «своих» даёт тему, прочие — null", () => {
    expect(
      topicOfOrgan(
        "Постановление Министерства по налогам и сборам Республики Беларусь от 1 июня 2026 г. № 5",
      ),
    ).toBe("taxes");
    expect(
      topicOfOrgan(
        "Постановление Национального статистического комитета Республики Беларусь от 12 октября 2026 г. № 76",
      ),
    ).toBeNull();
  });

  it("слова заголовка дают тему; нейтральный заголовок — null", () => {
    expect(topicOfTitle("О размерах государственных пособий семьям")).toBe("benefits");
    expect(topicOfTitle("О Министерстве антимонопольного регулирования и торговли")).toBeNull();
  });
});
