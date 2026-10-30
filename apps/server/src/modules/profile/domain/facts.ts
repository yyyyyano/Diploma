// Правила фактов профиля (PROF-01, PROF-05, PROF-06) — чистые функции: тема по ключу, приведение входа к хранимому
// значению и оценка факта с датой на день вопроса. «Сегодня» приходит аргументом (часы — у сценария).
import type { Child, FactEvaluation, FactTopic, FactValue, FactValueInput } from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";

/** Тема страницы «Что ассистент знает обо мне» по ключу факта; у заметки — своя. */
export function topicOf(value: FactValue): FactTopic {
  switch (value.key) {
    case "children":
    case "familyStatus":
    case "largeFamily":
      return "family";
    case "employment":
    case "mainEmployer":
      return "employment";
    case "housingQueue":
    case "property.apartment":
      return "housing";
    case "benefitCategory":
    case "youngSpecialist":
      return "benefits";
    case "income.salary":
    case "income.regular":
    case "finance.freeBalance":
      return "income";
    case "obligations.regular":
      return "obligations";
    case "property.land":
    case "property.car":
      return "property";
    case "note":
      return value.topic;
  }
}

/**
 * Хранимое значение из входа: возраст ребёнка без даты рождения запоминает день, когда его назвали (PROF-06), — через
 * годы видно, что ребёнку уже 18. Дата рождения точнее возраста: при ней возраст не хранится.
 */
export function toStoredValue(input: FactValueInput, today: LocalDate): FactValue {
  if (input.key !== "children") return input as FactValue;
  return {
    key: "children",
    children: input.children.map((child): Child => ({
      name: child.name ?? null,
      birthDate: child.birthDate ? LocalDate.parse(child.birthDate) : null,
      disability: child.disability ?? false,
      age: child.birthDate ? null : (child.age ?? null),
      ageOn: child.birthDate || child.age === null || child.age === undefined ? null : today,
    })),
  };
}

function parts(day: LocalDate): [number, number, number] {
  const [year = 0, month = 0, date = 0] = day.split("-").map(Number);
  return [year, month, date];
}

/** Полных лет от `from` до `to` (день рождения считается в свой день). */
export function fullYears(from: LocalDate, to: LocalDate): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  const beforeBirthday = m2 < m1 || (m2 === m1 && d2 < d1);
  return y2 - y1 - (beforeBirthday ? 1 : 0);
}

/**
 * PROF-06: возраст ребёнка на день вопроса — по дате рождения; без неё — названный возраст плюс прошедшие полные годы
 * (нижняя граница). Ни того ни другого — null.
 */
export function ageOn(child: Child, onDate: LocalDate): number | null {
  if (child.birthDate !== null) return Math.max(0, fullYears(child.birthDate, onDate));
  if (child.age === null || child.ageOn === null) return null;
  return child.age + Math.max(0, fullYears(child.ageOn, onDate));
}

/** PROF-06: факт с датой на день вопроса; у фактов без дат оценки нет. */
export function evaluate(value: FactValue, onDate: LocalDate): FactEvaluation | null {
  if (value.key === "children") {
    const childAges = value.children.map((child) => ageOn(child, onDate));
    // Стандартный вычет на детей — только на младших 18: исполнилось 18 — больше не считается.
    const childrenUnder18 = childAges.filter((age) => age !== null && age < 18).length;
    return { onDate, childAges, childrenUnder18 };
  }
  if (value.key === "youngSpecialist") {
    const youngSpecialistActive =
      value.until === null ? null : value.value && onDate <= value.until;
    return { onDate, youngSpecialistActive };
  }
  return null;
}
