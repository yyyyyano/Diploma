// WEEK-01, WEEK-02: шаблон текста без модели — пример SPEC («312 BYN — на 18 % больше обычного… лимит на кафе 85 %… интернет и рассрочка — 74 BYN»).
import { createWeeklyT } from "@kosht/i18n";
import { Money, TraceId } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { joinNames, templateText, type WeeklyFacts } from "./template.ts";

const t = createWeeklyT();
const TRACE = TraceId.parse("0190f0a0-0000-7000-8000-0000000000a1");
const amount = (minor: number) => ({ amount: Money.of(minor, "BYN"), traceId: TRACE });

const FACTS: WeeklyFacts = {
  weekStart: "2026-10-26" as never,
  weekEnd: "2026-11-01" as never,
  spent: amount(31_200),
  average: amount(26_441),
  deviation: { percent: 18, traceId: TRACE },
  weeksUsed: 8,
  categories: [{ key: "system:taxi", name: "Такси", amount: amount(9000) }],
  limits: [{ name: "Кафе", percent: 85, limit: Money.of(20_000, "BYN"), traceId: TRACE }],
  upcoming: {
    from: "2026-11-02" as never,
    to: "2026-11-08" as never,
    payments: amount(7400),
    items: [
      { title: "Интернет", on: "2026-11-03" as never, amount: Money.of(3000, "BYN") },
      { title: "Рассрочка", on: "2026-11-05" as never, amount: Money.of(4400, "BYN") },
    ],
  },
  foundDeductions: 0,
};

describe("templateText", () => {
  it("пример WEEK-01: траты, сравнение, главная категория, лимит, платежи недели", () => {
    expect(templateText(FACTS, t)).toBe(
      "На прошлой неделе вы потратили 312,00 BYN, на 18 % больше обычного. Больше всего — на Такси. Лимит «Кафе» израсходован на 85 %. В ближайшие 7 дней спишутся Интернет и Рассрочка — 74,00 BYN.",
    );
  });

  it("меньше обычного — без знака минус; как обычно; нет среднего — сравнения нет", () => {
    expect(templateText({ ...FACTS, deviation: { percent: -25, traceId: TRACE } }, t)).toContain(
      ", на 25 % меньше обычного",
    );
    expect(templateText({ ...FACTS, deviation: { percent: 0, traceId: TRACE } }, t)).toContain(
      ", как обычно",
    );
    const none = templateText({ ...FACTS, average: null, deviation: null }, t);
    expect(none).not.toContain("обычного");
    expect(none).toContain("потратили 312,00");
  });

  it("трат не было — одно предложение об этом, категории не называются", () => {
    const text = templateText({ ...FACTS, spent: amount(0), categories: [], deviation: null }, t);
    expect(text.startsWith("На прошлой неделе трат не было. ")).toBe(true);
    expect(text).not.toContain("Больше всего");
  });

  it("платежи без названий — просто сумма; нет платежей — предложения нет; вычеты — числом", () => {
    const unnamed = templateText({ ...FACTS, upcoming: { ...FACTS.upcoming, items: [] } }, t);
    expect(unnamed).toContain("спишутся платежи на 74,00");
    const quiet = templateText(
      {
        ...FACTS,
        limits: [],
        upcoming: { ...FACTS.upcoming, payments: null, items: [] },
        foundDeductions: 2,
      },
      t,
    );
    expect(quiet).not.toContain("спишутся");
    expect(quiet).toContain("Найдено вычетов, которые стоит оформить: 2");
  });
});

describe("joinNames", () => {
  it.each([
    [[], ""],
    [["такси"], "такси"],
    [["такси", "кафе"], "такси и кафе"],
    [["а", "б", "в"], "а, б и в"],
  ])("%j → «%s»", (names, text) => {
    expect(joinNames(names)).toBe(text);
  });
});
