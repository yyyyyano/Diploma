// TAX-02: тип занятости меняет расчёт — наёмный работник, плательщик НПД (вычетов к его доходу нет, но с зарплатой — по зарплате), ИП
// (вычеты только через декларацию), несколько видов дохода (у каждого своё правило).
import { describe, expect, it } from "vitest";
import { classifyEmployment } from "./employment.ts";

describe("TAX-02: тип занятости", () => {
  it("наёмный работник — расчёт без пометок", () => {
    expect(classifyEmployment(["employee"], true)).toEqual({ mode: "employee", flags: [] });
  });

  it("тип не известен или не указан — считаем как наёмного работника", () => {
    expect(classifyEmployment(null, false)).toEqual({ mode: "employee", flags: [] });
    expect(classifyEmployment([], false)).toEqual({ mode: "employee", flags: [] });
  });

  it("только НПД и зарплаты нет — вычет не считается: к доходу на НПД вычетов по ст. 209–211 нет", () => {
    expect(classifyEmployment(["npd"], false)).toEqual({ mode: "npd-only", flags: [] });
  });

  it("НПД и зарплата — расчёт по зарплате с пометкой", () => {
    expect(classifyEmployment(["npd"], true)).toEqual({
      mode: "employee",
      flags: ["npd-with-salary"],
    });
    expect(classifyEmployment(["employee", "npd"], false)).toEqual({
      mode: "employee",
      flags: ["npd-with-salary"],
    });
  });

  it("ИП — вычеты только через годовую декларацию", () => {
    expect(classifyEmployment(["ip"], false)).toEqual({ mode: "ip", flags: ["ip-declaration"] });
  });

  it("ИП и зарплата по найму — расчёт по зарплате (основное место работы), ИП-доход отдельно по своему правилу", () => {
    expect(classifyEmployment(["employee", "ip"], true)).toEqual({ mode: "employee", flags: [] });
  });

  it("студент, пенсионер, безработный — как наёмный: считаем по тому, что назвал человек", () => {
    expect(classifyEmployment(["student"], false)).toEqual({ mode: "employee", flags: [] });
  });
});
