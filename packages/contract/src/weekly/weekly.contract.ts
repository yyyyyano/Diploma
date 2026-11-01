// Итоги недели (WEEK-01…03): сводка за прошлую неделю — числа считает код (@kosht/calc, у каждого traceId для «Откуда эта цифра?»),
// текст пишет модель по готовым числам либо подставляется по шаблону, если модели нет. Сводка хранится (история), последняя —
// карточка на главной. Настройки: выключить, день недели и время отправки (WEEK-03).
import { TraceId } from "@kosht/kernel";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";

export const WeeklyAmount = z.strictObject({ amount: Money.schema, traceId: TraceId });

export const WEEKLY_TEXT_SOURCES = ["model", "template"] as const;
export const WeeklyTextSource = z.enum(WEEKLY_TEXT_SOURCES);
export type WeeklyTextSource = z.infer<typeof WeeklyTextSource>;

/** Сколько самых затратных категорий, лимитов и платежей показывает сводка. */
export const WEEKLY_TOP = 3;
export const WEEKLY_UPCOMING_ITEMS = 5;

export const WeeklySummary = z.strictObject({
  id: z.uuid(),
  /** Прошлая неделя — с понедельника по воскресенье. */
  weekStart: LocalDate.schema,
  weekEnd: LocalDate.schema,
  /** Траты за неделю (покупки минус возвраты, без переводов). */
  spent: WeeklyAmount,
  /** Средние траты за неделю за прошлые недели; истории нет — null. */
  average: WeeklyAmount.nullable(),
  /** На сколько процентов траты больше (+) или меньше (−) обычных; сравнивать не с чем — null. */
  deviation: z.strictObject({ percent: z.int(), traceId: TraceId }).nullable(),
  /** Сколько недель вошло в среднее (по умолчанию 8). */
  weeksUsed: z.int().min(0),
  /** Самые затратные категории недели. */
  categories: z
    .array(
      z.strictObject({ key: z.string().max(80), name: z.string().max(80), amount: WeeklyAmount }),
    )
    .max(WEEKLY_TOP),
  /** Лимиты, израсходованные на 80 % и больше. */
  limits: z
    .array(
      z.strictObject({
        name: z.string().max(80),
        percent: z.int().min(0),
        limit: Money.schema,
        traceId: TraceId,
      }),
    )
    .max(WEEKLY_TOP),
  /** Платежи и события на ближайшие семь дней со дня сводки. */
  upcoming: z.strictObject({
    from: LocalDate.schema,
    to: LocalDate.schema,
    payments: WeeklyAmount.nullable(),
    items: z
      .array(
        z.strictObject({
          title: z.string().max(200).nullable(),
          on: LocalDate.schema,
          amount: Money.schema.nullable(),
        }),
      )
      .max(WEEKLY_UPCOMING_ITEMS),
  }),
  /** Найденные вычеты, ждущие внимания, — число. */
  foundDeductions: z.int().min(0),
  text: z.string().max(2000),
  textSource: WeeklyTextSource,
  /** Когда сводка сформирована (ISO). */
  createdAt: z.iso.datetime(),
});
export type WeeklySummary = z.infer<typeof WeeklySummary>;

export const WeeklyLatest = z.strictObject({ summary: WeeklySummary.nullable() });
export const WeeklyHistory = z.strictObject({ items: z.array(WeeklySummary).max(52) });

/** День недели: 1 — понедельник … 7 — воскресенье. */
export const Weekday = z.int().min(1).max(7);

export const WeeklyPreferences = z.strictObject({
  enabled: z.boolean(),
  weekday: Weekday,
  /** Время отправки «чч:мм» по поясу системы. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
});
export type WeeklyPreferences = z.infer<typeof WeeklyPreferences>;

export const weeklyContract = {
  /** Последняя сводка для карточки на главной; сводки ещё не было — null. */
  latest: oc
    .route({ method: "GET", path: "/weekly/latest" })
    .input(z.strictObject({}))
    .output(WeeklyLatest)
    .errors(pickErrors("UNAUTHORIZED")),
  /** История сводок, свежие сверху. */
  history: oc
    .route({ method: "GET", path: "/weekly/history" })
    .input(z.strictObject({}))
    .output(WeeklyHistory)
    .errors(pickErrors("UNAUTHORIZED")),
  /** Настройки сводки: включена ли, день и время (WEEK-03). */
  preferences: oc
    .route({ method: "GET", path: "/weekly/preferences" })
    .input(z.strictObject({}))
    .output(WeeklyPreferences)
    .errors(pickErrors("UNAUTHORIZED")),
  setPreferences: oc
    .route({ method: "POST", path: "/weekly/preferences" })
    .input(WeeklyPreferences)
    .output(WeeklyPreferences)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
};
