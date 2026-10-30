// Профиль и память ассистента (PROF-01…06, AUTH-07): факты о пользователе, важные для законов РБ, с источником, датой
// и статусом «подтверждён / предположение»; анкета на 1 минуту после первого входа. Значение факта — по ключу
// (дискриминированное объединение): одна схема проверяет и форму сайта, и вход инструмента агента. Факты с датой
// (возраст ребёнка, срок молодого специалиста) сервер оценивает на дату вопроса — поле `evaluation` (PROF-06).
import { oc } from "@orpc/contract";
import { z } from "zod";
import { UndoToken } from "../actions/actions.contract.ts";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";

export const FactId = z.uuid().brand<"FactId">();
export type FactId = z.infer<typeof FactId>;

/** Темы страницы «Что ассистент знает обо мне» (PROF-05). */
export const FACT_TOPICS = [
  "family",
  "employment",
  "housing",
  "benefits",
  "income",
  "obligations",
  "property",
  "other",
] as const;
export const FactTopic = z.enum(FACT_TOPICS);
export type FactTopic = z.infer<typeof FactTopic>;

/** Откуда факт: анкета, чат (со ссылкой на сообщение), выписки, вывод системы, указан вручную на странице. */
export const FactSource = z.enum(["questionnaire", "chat", "statements", "system", "user"]);
export type FactSource = z.infer<typeof FactSource>;

/** PROF-03: выведенный системой факт — «предположение», пока человек его не подтвердит. */
export const FactStatus = z.enum(["confirmed", "assumed"]);
export type FactStatus = z.infer<typeof FactStatus>;

/** PROF-01: тип занятости (можно несколько сразу — зарплата + НПД). */
export const EmploymentType = z.enum([
  "employee",
  "npd",
  "ip",
  "unemployed",
  "pensioner",
  "student",
]);
export type EmploymentType = z.infer<typeof EmploymentType>;

/** PROF-01: одинокий родитель, вдова (вдовец), опекун или попечитель, приёмный родитель. */
export const FamilyStatus = z.enum(["singleParent", "widowed", "guardian", "fosterParent"]);
export type FamilyStatus = z.infer<typeof FamilyStatus>;

/** PROF-01: учёт нуждающихся в улучшении жилищных условий. */
export const HousingQueueStatus = z.enum(["now", "before", "no", "unknown"]);
export type HousingQueueStatus = z.infer<typeof HousingQueueStatus>;

/**
 * Ребёнок (PROF-01, PROF-06): дата рождения точнее возраста; возраст без даты помнит день, когда его назвали (`ageOn`
 * ставит сервер) — так «исполнилось 18» видно и через годы.
 */
export const ChildInput = z.strictObject({
  name: z.string().trim().max(60).nullable().default(null),
  birthDate: LocalDate.schema.nullable().default(null),
  age: z.int().min(0).max(40).nullable().default(null),
  disability: z.boolean().default(false),
});
export const Child = ChildInput.extend({ ageOn: LocalDate.schema.nullable() });
export type Child = z.infer<typeof Child>;

const yesNo = <K extends string>(key: K) =>
  z.strictObject({ key: z.literal(key), value: z.boolean() });

/** Значения ключей PROF-01 и PROF-03 без детей (у детей вход и хранение различаются — `ageOn`). */
const commonValues = [
  z.strictObject({
    key: z.literal("employment"),
    types: z.array(EmploymentType).min(1).max(6),
  }),
  z.strictObject({
    key: z.literal("mainEmployer"),
    has: z.boolean(),
    name: z.string().trim().max(120).nullable().default(null),
  }),
  z.strictObject({ key: z.literal("familyStatus"), statuses: z.array(FamilyStatus).max(4) }),
  yesNo("largeFamily"),
  z.strictObject({
    key: z.literal("housingQueue"),
    status: HousingQueueStatus,
    since: LocalDate.schema.nullable().default(null),
  }),
  yesNo("benefitCategory"),
  z.strictObject({
    key: z.literal("youngSpecialist"),
    value: z.boolean(),
    until: LocalDate.schema.nullable().default(null),
  }),
  yesNo("property.apartment"),
  yesNo("property.land"),
  yesNo("property.car"),
  z.strictObject({ key: z.literal("income.salary"), amount: Money.schema }),
  // PROF-03, REC-04: регулярный доход и обязательные платежи в месяц — вывод из регулярных платежей («предположение»).
  z.strictObject({ key: z.literal("income.regular"), amount: Money.schema }),
  z.strictObject({ key: z.literal("obligations.regular"), amount: Money.schema }),
  // FIN-20: свободный остаток в месяц «по данным за N мес.» — вывод `fin` («предположение»).
  z.strictObject({
    key: z.literal("finance.freeBalance"),
    amount: Money.schema,
    months: z.int().min(1).max(12),
  }),
  // Свой факт («Плачу за кружок 60 BYN в месяц»): тема и подпись — от человека.
  z.strictObject({
    key: z.literal("note"),
    topic: FactTopic,
    label: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(300),
  }),
] as const;

/** Значение факта по ключу (вход): ключи PROF-01 и PROF-03, «заметка» — свой факт со своей темой и подписью. */
export const FactValueInput = z.discriminatedUnion("key", [
  ...commonValues,
  z.strictObject({ key: z.literal("children"), children: z.array(ChildInput).max(20) }),
]);
export type FactValueInput = z.input<typeof FactValueInput>;

/** Значение факта, как его хранит сервер: у детей — день, на который назван возраст. */
export const FactValue = z.discriminatedUnion("key", [
  ...commonValues,
  z.strictObject({ key: z.literal("children"), children: z.array(Child).max(20) }),
]);
export type FactValue = z.infer<typeof FactValue>;

/** Ключи, которые выводит система (PROF-03): человек правит их на странице, агент через инструмент — нет. */
export const DERIVED_FACT_KEYS = [
  "income.regular",
  "obligations.regular",
  "finance.freeBalance",
] as const;

/** Ключ факта. */
export const FACT_KEYS = [
  "employment",
  "mainEmployer",
  "children",
  "familyStatus",
  "largeFamily",
  "housingQueue",
  "benefitCategory",
  "youngSpecialist",
  "property.apartment",
  "property.land",
  "property.car",
  "income.salary",
  "income.regular",
  "obligations.regular",
  "finance.freeBalance",
  "note",
] as const satisfies readonly FactValue["key"][];
export const FactKey = z.enum(FACT_KEYS);
export type FactKey = z.infer<typeof FactKey>;

/** PROF-06: оценка факта с датой на день вопроса — возраст каждого ребёнка и сколько из них младше 18. */
export const FactEvaluation = z.strictObject({
  onDate: LocalDate.schema,
  /** Возраст детей по порядку (полных лет; null — ни даты рождения, ни возраста). */
  childAges: z.array(z.int().min(0).nullable()).optional(),
  /** Дети младше 18 на эту дату: только их учитывает стандартный вычет на детей. */
  childrenUnder18: z.int().min(0).optional(),
  /** Срок молодого специалиста ещё идёт на эту дату (нет срока — null). */
  youngSpecialistActive: z.boolean().nullable().optional(),
});
export type FactEvaluation = z.infer<typeof FactEvaluation>;

export const ProfileFact = z.strictObject({
  id: FactId,
  topic: FactTopic,
  value: FactValue,
  source: FactSource,
  /** Чат — id сообщения; выписки и вывод системы — краткое основание (ключ словаря) или null. */
  sourceRef: z.string().max(200).nullable(),
  status: FactStatus,
  /** День, когда факт записан или изменён. */
  recordedOn: LocalDate.schema,
  evaluation: FactEvaluation.nullable(),
});
export type ProfileFact = z.infer<typeof ProfileFact>;

/** AUTH-07, PROF-02: ответы анкеты; пропущенного вопроса во входе нет. */
export const OnboardingAnswers = z.strictObject({
  employment: z.array(EmploymentType).min(1).max(6).optional(),
  children: z.array(ChildInput).max(20).optional(),
  housingQueue: HousingQueueStatus.optional(),
  benefitCategory: z.boolean().optional(),
  youngSpecialist: z.boolean().optional(),
  familyStatus: z.array(FamilyStatus).max(4).optional(),
});
export type OnboardingAnswers = z.input<typeof OnboardingAnswers>;

const FactChange = z.strictObject({ fact: ProfileFact, undoToken: UndoToken });

export const profileContract = {
  /** Все факты домохозяйства, оценённые на сегодня (PROF-05). */
  facts: oc
    .route({ method: "GET", path: "/profile/facts" })
    .output(z.strictObject({ onDate: LocalDate.schema, facts: z.array(ProfileFact) }))
    .errors(pickErrors("UNAUTHORIZED")),
  /** Показать ли анкету: pending — после первого входа её ещё не проходили и не пропускали (AUTH-07). */
  onboarding: oc
    .route({ method: "GET", path: "/profile/onboarding" })
    .output(z.strictObject({ status: z.enum(["pending", "done"]) }))
    .errors(pickErrors("UNAUTHORIZED")),
  /** Анкета пройдена или пропущена (пустые ответы): сохраняет отвеченное фактами «анкета», больше не показывается. */
  completeOnboarding: oc
    .route({ method: "POST", path: "/profile/onboarding" })
    .input(z.strictObject({ answers: OnboardingAnswers }))
    .output(z.strictObject({ facts: z.array(ProfileFact) }))
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
  /** Добавить или исправить факт (ключ PROF-01 — один на профиль; заметка — по id) с «Отменить». */
  setFact: oc
    .route({ method: "POST", path: "/profile/facts" })
    .input(z.strictObject({ id: FactId.optional(), value: FactValueInput }))
    .output(FactChange)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION", "NOT_FOUND")),
  /** Подтвердить предположение (PROF-03) с «Отменить». */
  confirmFact: oc
    .route({ method: "POST", path: "/profile/facts/confirm" })
    .input(z.strictObject({ id: FactId }))
    .output(FactChange)
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
  /** Удалить факт с «Отменить»: удалённый больше не используется (PROF-05). */
  deleteFact: oc
    .route({ method: "POST", path: "/profile/facts/delete" })
    .input(z.strictObject({ id: FactId }))
    .output(z.strictObject({ undoToken: UndoToken }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
};
