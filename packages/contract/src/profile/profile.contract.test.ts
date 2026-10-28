// PROF-01, PROF-06: форма фактов на проводе — ключ определяет значение, у ребёнка возраст без даты помнит день,
// когда его назвали; список ключей совпадает с объединением значений (новый ключ не потеряется в enum).
import { describe, expect, it } from "vitest";
import { FACT_KEYS, FactValue, FactValueInput, OnboardingAnswers } from "./profile.contract.ts";

describe("PROF-01: значение факта по ключу", () => {
  it("список ключей — ровно ключи объединения значений", () => {
    expect(FactValue.options.map((option) => option.shape.key.value).toSorted()).toEqual(
      [...FACT_KEYS].toSorted(),
    );
    expect(FactValueInput.options.map((option) => option.shape.key.value).toSorted()).toEqual(
      [...FACT_KEYS].toSorted(),
    );
  });

  it("ребёнок на входе — без ageOn, с умолчаниями; лишнее поле не проходит", () => {
    expect(FactValueInput.parse({ key: "children", children: [{ age: 5 }] })).toEqual({
      key: "children",
      children: [{ name: null, birthDate: null, age: 5, disability: false }],
    });
    expect(
      FactValueInput.safeParse({ key: "children", children: [{ age: 5, ageOn: "2026-10-28" }] })
        .success,
    ).toBe(false);
  });

  it("тип занятости — хотя бы один; чужой ключ — ошибка", () => {
    expect(FactValueInput.safeParse({ key: "employment", types: [] }).success).toBe(false);
    expect(FactValueInput.safeParse({ key: "salary", value: true }).success).toBe(false);
  });

  it("заметка — тема, подпись и текст без пустых строк", () => {
    expect(
      FactValueInput.safeParse({ key: "note", topic: "other", label: " ", text: "x" }).success,
    ).toBe(false);
  });
});

describe("AUTH-07, PROF-02: ответы анкеты", () => {
  it("каждый вопрос можно пропустить — пустые ответы проходят", () => {
    expect(OnboardingAnswers.parse({})).toEqual({});
  });
});
