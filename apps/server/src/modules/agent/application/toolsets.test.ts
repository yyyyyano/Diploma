// AGT-03, ARCHITECTURE §8.2: набор инструментов выбирают правила по словам и странице — без модели.
import { describe, expect, it } from "vitest";
import { inToolset, selectToolset } from "./toolsets.ts";

describe("selectToolset: слова", () => {
  it.each([
    ["Какой вычет положен за ребёнка по ст. 210?", "legal"],
    ["Можно вернуть товар надлежащего качества?", "legal"],
    // LEGAL-09: права потребителя без слова «закон» — покупка, обмен, возврат.
    ["Купил пылесос 10 дней назад, хочу вернуть", "legal"],
    ["В какой срок можно обменять непродовольственный товар надлежащего качества?", "legal"],
    ["Продавец отказывается принять товар обратно", "legal"],
    ["Сколько налога с аренды квартиры", "legal"],
    ["Поставь лимит на такси 200 рублей", "planning"],
    ["Отложи 200 на отпуск в копилку", "planning"],
    ["Какой у меня свободный остаток?", "planning"],
    ["Откуда эта цифра?", "planning"],
    ["Выгрузи отчёт в Excel за сентябрь", "reports"],
    ["Как идёт разбор выписки?", "reports"],
    ["Потратил 15 рублей на кофе", "core"],
    ["Удали все траты за вчера", "core"],
    ["а в августе?", "core"],
  ])("«%s» → %s", (text, toolset) => {
    expect(selectToolset({ text }).toolset).toBe(toolset);
  });

  // CAL-06: «напомни», «напоминание», «календарь» — планирование раньше права: напоминание про налог — событие, а не вопрос о законе.
  it.each([
    ["напомни заплатить налог 15 ноября", "planning"],
    ["Напомни 1 декабря оплатить садик", "planning"],
    ["Поставь напоминание про гарантию на пылесос", "planning"],
    ["Что у меня в календаре до конца месяца?", "planning"],
    ["Когда платить налог на недвижимость?", "legal"],
  ])("«%s» → %s", (text, toolset) => {
    expect(selectToolset({ text }).toolset).toBe(toolset);
  });

  // AFF-01: оба примера SPEC и слова «позвол…», «безопасный платёж», «ПДН», «долговая нагрузка» — планирование (сценарии покупки).
  it.each([
    ["Могу ли я купить ноутбук за 3 000?", "planning"],
    ["Потяну ли машину за 40 000?", "planning"],
    ["Могу ли я позволить себе отпуск?", "planning"],
    ["Что позволяет мой бюджет?", "planning"],
    ["Какой безопасный платёж по кредиту?", "planning"],
    ["Сколько я могу платить с учётом ПДН", "planning"],
    ["Какая у меня долговая нагрузка?", "planning"],
    // Слова права точнее «позвол…»: вопрос о законе остаётся в legal.
    ["Что мне позволяет закон о защите прав потребителей?", "legal"],
  ])("«%s» → %s", (text, toolset) => {
    expect(selectToolset({ text }).toolset).toBe(toolset);
  });

  it("совпали слова двух наборов — приоритет у права: «налог» и «лимит»", () => {
    expect(selectToolset({ text: "Налог и лимит" }).toolset).toBe("legal");
  });

  it("«ё» и регистр не важны", () => {
    expect(selectToolset({ text: "ОТЧЁТ за месяц" })).toEqual({
      toolset: "reports",
      reason: "words",
    });
  });
});

describe("selectToolset: страница", () => {
  it.each([
    ["/laws", "legal"],
    ["/laws/HK9800166", "legal"],
    // T-045: на «Налоговых вычетах» вопрос идёт в набор с calculate_deduction и get_checklist.
    ["/deductions", "legal"],
    ["/budget", "planning"],
    ["/recurring", "planning"],
    ["/accounts", "planning"],
    // T-049: на «Могу ли я позволить покупку?» вопрос идёт в набор с afford_scenarios и safe_loan_payment.
    ["/afford", "planning"],
    ["/documents", "reports"],
    ["/operations", "core"],
    ["/home", "core"],
    ["/assistant", "core"],
  ])("страница %s → %s, когда слов нет", (route, toolset) => {
    expect(selectToolset({ text: "что тут?", route }).toolset).toBe(toolset);
  });

  it("слова точнее страницы: на «Операциях» вопрос про закон — в legal", () => {
    expect(selectToolset({ text: "что говорит закон", route: "/operations" })).toEqual({
      toolset: "legal",
      reason: "words",
    });
  });

  it("причина выбора: страница, слова, умолчание", () => {
    expect(selectToolset({ text: "привет", route: "/budget" }).reason).toBe("page");
    expect(selectToolset({ text: "привет" }).reason).toBe("default");
  });

  it("префикс маршрута не путается с похожим: /laws-draft — не законы", () => {
    expect(selectToolset({ text: "привет", route: "/laws-draft" }).toolset).toBe("core");
  });
});

describe("inToolset", () => {
  it("core входит в любой набор, свой набор — только в себя", () => {
    expect(inToolset("core", "legal")).toBe(true);
    expect(inToolset("legal", "legal")).toBe(true);
    expect(inToolset("legal", "planning")).toBe(false);
    expect(inToolset("planning", "core")).toBe(false);
  });
});
