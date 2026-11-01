// Календарь (CAL-01…08): месяц и список «ближайшие» с событиями из двух источников — хранимые (свои, гарантии, налоги,
// страховки: у них есть напоминания) и вычисляемые при запросе (регулярные платежи, кредиты и поступления из `recurring`:
// даты не копируются). Суммы — Money в BYN, у каждой показанной суммы и итога — `traceId` («Откуда эта цифра?»); текст
// события — на сайте по `type`, `rule` и `origin`, на проводе нет отформатированных строк. Создание и правка — с «Отменить»,
// удаление — только решением «Да/Нет» (P5, AGT-07).
import { TraceId } from "@kosht/kernel";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { DecisionId, UndoToken } from "../actions/actions.contract.ts";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";

export const CalendarEventId = z.uuid().brand<"CalendarEventId">();
export type CalendarEventId = z.infer<typeof CalendarEventId>;

/** CAL-01: тип события — значок и цвет: налог, кредит, регулярный платёж, доход, гарантия, страховка, своё. */
export const CALENDAR_TYPES = [
  "tax",
  "credit",
  "recurring",
  "income",
  "warranty",
  "insurance",
  "own",
] as const;
export const CalendarType = z.enum(CALENDAR_TYPES);
export type CalendarType = z.infer<typeof CalendarType>;

/** Типы, которые человек может создать сам (форма «Новое событие»); доходы и регулярные платежи — из `recurring`. */
export const CREATABLE_TYPES = ["own", "tax", "insurance", "credit", "warranty"] as const;
export const CreatableType = z.enum(CREATABLE_TYPES);
export type CreatableType = z.infer<typeof CreatableType>;

/** За сколько дней напомнить: 0 — в день события, 1, 7, 30 (CAL-07; гарантия — ещё за 30, CAL-04). */
export const REMIND_DAYS = [0, 1, 7, 30] as const;
export const RemindDays = z
  .array(z.union([z.literal(0), z.literal(1), z.literal(7), z.literal(30)]))
  .max(4);
export type RemindDays = z.infer<typeof RemindDays>;

/** Сколько записей возвращает один запрос: страховка от «сотен платежей на год». */
export const CALENDAR_MAX_ENTRIES = 400;

/**
 * Откуда событие («Откуда это событие» в карточке): `user` — добавлено на сайте, `chat` — ассистентом по просьбе, `warranty` —
 * чек (магазин, день покупки, срок), `rule` — срок из таблицы сроков и факт профиля, `insurance` — платёж страховой, `recurring` —
 * история платежей (имя), `income` — история поступлений. Параметры — для подстановки в текст, только числа, id и названия.
 */
export const CALENDAR_ORIGINS = [
  "user",
  "chat",
  "warranty",
  "rule",
  "insurance",
  "recurring",
  "income",
] as const;
export const CalendarOrigin = z.strictObject({
  kind: z.enum(CALENDAR_ORIGINS),
  params: z.record(z.string().max(64), z.union([z.string().max(200), z.number()])),
});
export type CalendarOrigin = z.infer<typeof CalendarOrigin>;

/** Ссылка на связанный объект: чек (`receipt`), регулярный платёж (`recurring`), операция (`transaction`). */
export const CalendarRef = z.strictObject({
  entity: z.enum(["receipt", "recurring", "transaction"]),
  id: z.uuid(),
});

export const CalendarEntry = z.strictObject({
  /** Хранимое событие — его uuid; вычисляемое — `recurring:<id платежа>:<день>`. */
  id: z.string().max(100),
  type: CalendarType,
  /** Название как записано человеком или названием позиции чека / платежа; у событий по правилам срока — null (текст по `rule`). */
  title: z.string().max(200).nullable(),
  /** Ключ правила срока налога или страховки: название события — из словаря сайта. */
  rule: z.string().max(40).nullable(),
  /** День события; `null` — норма не привязывает срок к дате: напоминание появится, когда человек укажет день (CAL-02). */
  on: LocalDate.schema.nullable(),
  amount: Money.schema.nullable(),
  /** «≈»: сумма — среднее по истории платежей, а не точная. */
  approx: z.boolean(),
  /** Куда идут деньги: платёж или поступление; у события без суммы — null. */
  direction: z.enum(["out", "in"]).nullable(),
  /** Расчёт показанной суммы («Откуда эта цифра?»). */
  traceId: TraceId.nullable(),
  /** Хранимое событие: у него есть напоминания и (у своих) удаление. */
  stored: z.boolean(),
  remindDays: RemindDays,
  /** Человек может удалить событие: только добавленные им (свои, кредит, страховка вручную). */
  canDelete: z.boolean(),
  origin: CalendarOrigin,
  ref: CalendarRef.nullable(),
});
export type CalendarEntry = z.infer<typeof CalendarEntry>;

/** Итоги по списку событий: платежи и поступления, у каждого — число с расчётом; нет слагаемых — null. */
export const CalendarTotals = z.strictObject({
  payments: z.strictObject({ amount: Money.schema, traceId: TraceId }).nullable(),
  income: z.strictObject({ amount: Money.schema, traceId: TraceId }).nullable(),
});
export type CalendarTotals = z.infer<typeof CalendarTotals>;

/** Месяц «ГГГГ-ММ». */
export const CalendarMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const CalendarMonthView = z.strictObject({
  today: LocalDate.schema,
  month: CalendarMonth,
  /** События сетки месяца: с понедельника первой недели по воскресенье последней (дни соседних месяцев — серые). */
  from: LocalDate.schema,
  to: LocalDate.schema,
  entries: z.array(CalendarEntry).max(CALENDAR_MAX_ENTRIES),
  /** Итоги — только по дням самого месяца. */
  totals: CalendarTotals,
});
export type CalendarMonthView = z.infer<typeof CalendarMonthView>;

/** Группы списка «Ближайшие»: «Укажите дату» (правила без даты), эта неделя, следующая, месяцы дальше, «Позже». */
export const CalendarGroupKey = z
  .string()
  .regex(/^(undated|week-0|week-1|month-\d{4}-\d{2}|later)$/);

export const CalendarGroup = z.strictObject({
  key: CalendarGroupKey,
  from: LocalDate.schema,
  /** У группы «Позже» конца нет. */
  to: LocalDate.schema.nullable(),
  entries: z.array(CalendarEntry),
  totals: CalendarTotals,
});

export const CalendarUpcoming = z.strictObject({
  today: LocalDate.schema,
  groups: z.array(CalendarGroup).max(20),
});
export type CalendarUpcoming = z.infer<typeof CalendarUpcoming>;

/** Диапазон событий для инструмента агента и главной: плоский список с итогами. */
export const CalendarRange = z.strictObject({
  today: LocalDate.schema,
  from: LocalDate.schema,
  to: LocalDate.schema,
  entries: z.array(CalendarEntry).max(CALENDAR_MAX_ENTRIES),
  totals: CalendarTotals,
});
export type CalendarRange = z.infer<typeof CalendarRange>;

/** Новое событие (CAL-06): название, день, необязательная сумма, тип и напоминания (по умолчанию 7 и 1 день). */
export const CreateEventInput = z.strictObject({
  title: z.string().trim().min(1).max(120),
  on: LocalDate.schema,
  amount: Money.schema.optional(),
  type: CreatableType.default("own"),
  remindDays: RemindDays.optional(),
});
export type CreateEventInput = z.input<typeof CreateEventInput>;

/** Правка события: день и напоминания (у гарантии день — конец срока, он «изменяем», CAL-04). */
export const UpdateEventInput = z.strictObject({
  id: CalendarEventId,
  on: LocalDate.schema.optional(),
  remindDays: RemindDays.optional(),
});
export type UpdateEventInput = z.infer<typeof UpdateEventInput>;

/** PROF-07: что спрашивает баннер календаря — автомобиль, квартира или дом, земельный участок. */
export const PROPERTY_KINDS = ["car", "apartment", "land"] as const;
export const PropertyKind = z.enum(PROPERTY_KINDS);
export type PropertyKind = z.infer<typeof PropertyKind>;

/**
 * Вопрос об имуществе: `evidence` — на чём основано предположение (топливо, платёж страховщику, уплата налога); `null` — признаков в
 * операциях нет, это единственный вопрос про автомобиль при первом открытии календаря.
 */
export const PropertyQuestion = z.strictObject({
  kind: PropertyKind,
  evidence: z.enum(["fuel", "insurance", "tax"]).nullable(),
});
export type PropertyQuestion = z.infer<typeof PropertyQuestion>;

const EventChange = z.strictObject({ event: CalendarEntry, undoToken: UndoToken });

const ReadErrors = pickErrors("UNAUTHORIZED", "VALIDATION");

export const calendarContract = {
  /** Месяц (CAL-01): события сетки и итоги месяца. */
  month: oc
    .route({ method: "GET", path: "/calendar/month" })
    .input(z.strictObject({ month: CalendarMonth.optional() }))
    .output(CalendarMonthView)
    .errors(ReadErrors),
  /** Список «Ближайшие» (CAL-01): группы по неделям и месяцам с суммами. */
  upcoming: oc
    .route({ method: "GET", path: "/calendar/upcoming" })
    .output(CalendarUpcoming)
    .errors(pickErrors("UNAUTHORIZED")),
  /** Своё событие (CAL-06) с «Отменить». Прошедший день — `VALIDATION`. */
  create: oc
    .route({ method: "POST", path: "/calendar/event" })
    .input(CreateEventInput)
    .output(EventChange)
    .errors(ReadErrors),
  /** День и напоминания хранимого события; вычисляемое (регулярный платёж) править нельзя — `NOT_FOUND`. */
  update: oc
    .route({ method: "POST", path: "/calendar/event/update" })
    .input(UpdateEventInput)
    .output(EventChange)
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND", "VALIDATION")),
  /** Удаление — только решением «Да/Нет» (AGT-07); удалить можно только добавленное человеком. */
  requestDelete: oc
    .route({ method: "POST", path: "/calendar/event/delete" })
    .input(z.strictObject({ id: CalendarEventId }))
    .output(z.strictObject({ decisionId: DecisionId }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND", "VALIDATION")),
  /** Вопрос об имуществе для баннера (PROF-07); `null` — спрашивать нечего. */
  propertyQuestion: oc
    .route({ method: "GET", path: "/calendar/property-question" })
    .output(z.strictObject({ question: PropertyQuestion.nullable() }))
    .errors(pickErrors("UNAUTHORIZED")),
  /** Ответ «да» или «нет»: факт профиля «подтверждён» с «Отменить»; налоги и страховки пересчитываются сразу. */
  answerProperty: oc
    .route({ method: "POST", path: "/calendar/property-answer" })
    .input(z.strictObject({ kind: PropertyKind, has: z.boolean() }))
    .output(z.strictObject({ undoToken: UndoToken }))
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
};
