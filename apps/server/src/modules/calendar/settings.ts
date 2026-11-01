// Настройки calendar (CAL-04, CAL-07, NFR-23): за сколько дней напоминать, во сколько присылать, как далеко вперёд читать
// регулярные платежи для списка. Умолчания — из SPEC; меняются без правки кода.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

const Days = z.array(z.union([z.literal(0), z.literal(1), z.literal(7), z.literal(30)])).max(4);

/** CAL-07: напоминания по умолчанию — за 7 дней и за 1 день (в событии настраивается). */
export const REMIND_DAYS = defineSetting({
  key: "calendar.remind-days",
  schema: Days,
  default: [7, 1] as (0 | 1 | 7 | 30)[],
});

/** CAL-04: у гарантии напоминание дополнительно за 30 дней. */
export const WARRANTY_REMIND_DAYS = defineSetting({
  key: "calendar.warranty-remind-days",
  schema: Days,
  default: [30, 7, 1] as (0 | 1 | 7 | 30)[],
});

/** Время суток «чч:мм» по поясу системы, в которое приходят напоминания. */
export const REMIND_TIME = defineSetting({
  key: "calendar.remind-time",
  schema: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
  default: "09:00",
});

/** Сколько дней вперёд список «Ближайшие» берёт регулярные платежи из `recurring` (хранимые события — любой даты). */
export const UPCOMING_DAYS = defineSetting({
  key: "calendar.upcoming-days",
  schema: z.int().min(7).max(366),
  default: 90,
});

/** CAL-05: за сколько дней напомнить о продлении страховки (12.03 → 5 марта). */
export const INSURANCE_REMIND_DAYS = defineSetting({
  key: "calendar.insurance-remind-days",
  schema: Days,
  default: [7] as (0 | 1 | 7 | 30)[],
});

const Words = z.array(z.string().trim().min(1).max(60)).max(40);

/**
 * PROF-07, CAL-05: слова названия контрагента или описания операции — признаки страховщика и имущества (в нижнем регистре, поиск по
 * подстроке). Операции не хранят MCC, поэтому страховщик определяется только по словарю названий. Автомобиль — ещё и по расходам
 * категории «Авто» (топливо).
 */
export const EVIDENCE_WORDS = defineSetting({
  key: "calendar.evidence-words",
  schema: z.strictObject({ insurer: Words, apartment: Words, land: Words }),
  default: {
    insurer: ["страх", "стравита"],
    apartment: ["налог на недвижимость"],
    land: ["земельный налог"],
  },
});

/** Как далеко назад (дней) искать в операциях признаки имущества и годовой платёж страховщику. */
export const EVIDENCE_DAYS = defineSetting({
  key: "calendar.evidence-days",
  schema: z.int().min(30).max(800),
  default: 400,
});

export const CALENDAR_SETTINGS = [
  REMIND_DAYS,
  WARRANTY_REMIND_DAYS,
  REMIND_TIME,
  UPCOMING_DAYS,
  INSURANCE_REMIND_DAYS,
  EVIDENCE_WORDS,
  EVIDENCE_DAYS,
] as const;
