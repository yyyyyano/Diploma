// PROF-01, PROF-06: темы фактов, хранимое значение и оценка на дату вопроса.
import type { Child } from "@kosht/contract";
import { day } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { ageOn, evaluate, fullYears, toStoredValue, topicOf } from "./facts.ts";

const child = (patch: Partial<Child>): Child => ({
  name: null,
  birthDate: null,
  age: null,
  ageOn: null,
  disability: false,
  ...patch,
});

describe("PROF-06: дети на дату вопроса", () => {
  it("ребёнок, которому исполнилось 18, в детях для вычета не учитывается", () => {
    const value = {
      key: "children" as const,
      children: [child({ birthDate: day("2009-03-14") }), child({ birthDate: day("2017-05-01") })],
    };
    expect(evaluate(value, day("2027-03-13"))).toEqual({
      onDate: day("2027-03-13"),
      childAges: [17, 9],
      childrenUnder18: 2,
    });
    expect(evaluate(value, day("2027-03-14"))).toEqual({
      onDate: day("2027-03-14"),
      childAges: [18, 9],
      childrenUnder18: 1,
    });
  });

  it("возраст без даты рождения растёт с годами от дня, когда его назвали", () => {
    const named = child({ age: 17, ageOn: day("2026-10-28") });
    expect(ageOn(named, day("2027-10-27"))).toBe(17);
    expect(ageOn(named, day("2027-10-28"))).toBe(18);
  });

  it("ни даты, ни возраста — возраст неизвестен и в вычет не идёт", () => {
    expect(evaluate({ key: "children", children: [child({})] }, day("2026-10-28"))).toEqual({
      onDate: day("2026-10-28"),
      childAges: [null],
      childrenUnder18: 0,
    });
  });

  it("полные годы: день рождения считается в свой день, дата раньше рождения — 0 лет", () => {
    expect(fullYears(day("2008-02-29"), day("2026-02-28"))).toBe(17);
    expect(fullYears(day("2008-02-29"), day("2026-03-01"))).toBe(18);
    expect(ageOn(child({ birthDate: day("2027-01-01") }), day("2026-10-28"))).toBe(0);
  });
});

describe("PROF-06: срок молодого специалиста", () => {
  it("до конца срока — идёт, после — нет; без срока — неизвестно", () => {
    const young = { key: "youngSpecialist" as const, value: true, until: day("2027-08-01") };
    expect(evaluate(young, day("2027-08-01"))?.youngSpecialistActive).toBe(true);
    expect(evaluate(young, day("2027-08-02"))?.youngSpecialistActive).toBe(false);
    expect(
      evaluate({ ...young, until: null }, day("2026-10-28"))?.youngSpecialistActive,
    ).toBeNull();
  });

  it("у фактов без дат оценки нет", () => {
    expect(evaluate({ key: "largeFamily", value: true }, day("2026-10-28"))).toBeNull();
  });
});

describe("PROF-01: хранимое значение и тема", () => {
  it("возраст ребёнка запоминает день ответа, дата рождения — без возраста", () => {
    expect(
      toStoredValue(
        {
          key: "children",
          children: [
            { age: 5 },
            { birthDate: day("2015-01-01"), age: 11, disability: true },
            { name: "Маша" },
          ],
        },
        day("2026-10-28"),
      ),
    ).toEqual({
      key: "children",
      children: [
        child({ age: 5, ageOn: day("2026-10-28") }),
        child({ birthDate: day("2015-01-01"), disability: true }),
        child({ name: "Маша" }),
      ],
    });
  });

  it("прочие значения не меняются", () => {
    const value = { key: "largeFamily" as const, value: false };
    expect(toStoredValue(value, day("2026-10-28"))).toBe(value);
  });

  it.each([
    [{ key: "children" as const, children: [] }, "family"],
    [{ key: "familyStatus" as const, statuses: [] }, "family"],
    [{ key: "largeFamily" as const, value: true }, "family"],
    [{ key: "employment" as const, types: ["npd" as const] }, "employment"],
    [{ key: "mainEmployer" as const, has: true, name: null }, "employment"],
    [{ key: "housingQueue" as const, status: "now" as const, since: null }, "housing"],
    [{ key: "property.apartment" as const, value: true }, "housing"],
    [{ key: "benefitCategory" as const, value: false }, "benefits"],
    [{ key: "youngSpecialist" as const, value: false, until: null }, "benefits"],
    [{ key: "income.salary" as const, amount: { minor: 1, currency: "BYN" } }, "income"],
    [{ key: "property.land" as const, value: true }, "property"],
    [{ key: "property.car" as const, value: true }, "property"],
    [
      { key: "note" as const, topic: "obligations" as const, label: "Кружок", text: "60 BYN" },
      "obligations",
    ],
  ])("%o → тема %s", (value, topic) => {
    expect(topicOf(value)).toBe(topic);
  });
});
