// PROF-05, PROF-06: форма факта — черновик из сохранённого факта и обратно во вход контракта.
import type { ProfileFact } from "@kosht/contract";
import { describe, expect, it } from "vitest";
import { draftOf, toInput } from "./FactEditor.tsx";

const base = {
  id: "0199f0a0-0000-7000-8000-0000000000f1",
  source: "user",
  sourceRef: null,
  status: "confirmed",
  recordedOn: "2026-10-28",
} as const;

describe("PROF-06: правка детей не «омолаживает» ребёнка", () => {
  it("возраст без даты рождения — сегодняшний из оценки сервера, дата рождения — как есть", () => {
    const fact = {
      ...base,
      topic: "family",
      value: {
        key: "children",
        children: [
          { name: null, birthDate: null, age: 5, ageOn: "2025-01-01", disability: false },
          { name: "Аня", birthDate: "2015-02-03", age: null, ageOn: null, disability: true },
        ],
      },
      evaluation: { onDate: "2026-10-28", childAges: [6, 11], childrenUnder18: 2 },
    } as ProfileFact;
    expect(toInput("children", draftOf(fact))).toEqual({
      key: "children",
      children: [
        { name: null, birthDate: null, age: 6, disability: false },
        { name: "Аня", birthDate: "2015-02-03", age: null, disability: true },
      ],
    });
  });
});

describe("PROF-05: значения форм", () => {
  it("зарплата: «2 400,50» → 240 050 копеек; сохранённая сумма читается обратно", () => {
    const fact = {
      ...base,
      topic: "income",
      value: { key: "income.salary", amount: { minor: 240_050, currency: "BYN" } },
      evaluation: null,
    } as ProfileFact;
    expect(toInput("income.salary", draftOf(fact))).toEqual({
      key: "income.salary",
      amount: { minor: 240_050, currency: "BYN" },
    });
    expect(toInput("income.salary", { ...draftOf(undefined), amount: "абв" })).toBeUndefined();
  });

  it("да/нет без выбора — не сохраняется; учёт нуждающихся с датой", () => {
    expect(toInput("largeFamily", draftOf(undefined))).toBeUndefined();
    expect(
      toInput("housingQueue", { ...draftOf(undefined), housing: "now", date: "2019-01-01" }),
    ).toEqual({ key: "housingQueue", status: "now", since: "2019-01-01" });
  });

  it("наниматель: «есть» с названием; «нет» — без названия", () => {
    expect(
      toInput("mainEmployer", { ...draftOf(undefined), flag: "yes", name: "ООО «Пример»" }),
    ).toEqual({ key: "mainEmployer", has: true, name: "ООО «Пример»" });
    expect(toInput("mainEmployer", { ...draftOf(undefined), flag: "no", name: "x" })).toEqual({
      key: "mainEmployer",
      has: false,
      name: null,
    });
  });

  it.each([
    [{ key: "employment", types: ["npd"] }],
    [{ key: "familyStatus", statuses: ["guardian"] }],
    [{ key: "youngSpecialist", value: true, until: "2027-08-01" }],
    [{ key: "property.land", value: false }],
    [{ key: "note", topic: "other", label: "Кружок", text: "60 BYN" }],
  ])("%o — туда и обратно без потерь", (value) => {
    const fact = { ...base, topic: "other", value, evaluation: null } as ProfileFact;
    expect(toInput(value.key as never, draftOf(fact))).toEqual(value);
  });
});
