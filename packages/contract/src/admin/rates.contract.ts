// Вкладка «Таблица ставок» администрирования (ADM-11, TAX-03, LAW-33): «параметр → период → значение → источник → кто и когда
// подтвердил». Общие числа нормы без данных пользователей (PRIV-07). Значение — целое: копейки BYN или сотые доли процента (по единице
// параметра); калькулятор берёт только подтверждённые, новые и изменённые вступают в силу после «Подтвердить».
import { z } from "zod";
import { LawPravoId } from "./laws.contract.ts";

export const RATE_STATUSES = ["pending", "confirmed", "superseded"] as const;
export const RateStatus = z.enum(RATE_STATUSES);
export type RateStatus = z.infer<typeof RateStatus>;

/** Копейки BYN, сотые доли процента, месяцы, день года (месяц × 100 + день), число месяца — единицы значения (CAL-02, CAL-04). */
export const RateUnit = z.enum(["byn-minor", "percent-bp", "months", "month-day", "day-of-month"]);
export type RateUnit = z.infer<typeof RateUnit>;

export const RateGroup = z.enum([
  "std-deduction",
  "ndfl-rate",
  "ip",
  "npd",
  "fszn",
  "pdn",
  "warranty",
  "deadline",
]);
export type RateGroup = z.infer<typeof RateGroup>;

export const RateRow = z.strictObject({
  id: z.uuid(),
  param: z.string().max(64),
  unit: RateUnit,
  group: RateGroup,
  validFrom: z.iso.date(),
  validTo: z.iso.date().nullable(),
  value: z.int().min(0),
  status: RateStatus,
  /** Источник: акт pravo.by (ID), статья и пункт; либо адрес вне pravo.by (Нацбанк). */
  source: z.strictObject({
    act: z.string().max(20).nullable(),
    article: z.string().max(20).nullable(),
    point: z.string().max(20).nullable(),
    url: z.string().max(500).nullable(),
    /** Ссылка на версию фрагмента заполнена: акт проиндексирован, число найдено в тексте. */
    linked: z.boolean(),
  }),
  /** Кто и когда подтвердил; у ожидающих и вытесненных без подтверждения — null. */
  confirmed: z.strictObject({ by: z.enum(["developer", "admin"]), on: z.iso.date() }).nullable(),
  /** Пометка LAW-33: в новой редакции нормы числа не нашлось — проверьте значение. */
  drift: z.boolean(),
});
export type RateRow = z.infer<typeof RateRow>;

export const RatesTable = z.strictObject({
  items: z.array(RateRow).max(1000),
  counts: z.strictObject({
    /** Значения, ждущие «Подтвердить». */
    pending: z.int().min(0),
    /** Подтверждённые значения с пометкой о расхождении. */
    drift: z.int().min(0),
  }),
});
export type RatesTable = z.infer<typeof RatesTable>;

/** Новое или изменённое значение: уходит ожидать «Подтвердить»; в силу не вступает. */
export const ProposeRateInput = z.strictObject({
  param: z.string().max(64),
  validFrom: z.iso.date(),
  validTo: z.iso.date().nullable(),
  value: z.int().min(0).max(1_000_000_000_000),
  sourceAct: LawPravoId.nullable(),
  sourceArticle: z.string().trim().max(20).nullable(),
  sourcePoint: z.string().trim().max(20).nullable(),
  sourceUrl: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .nullable(),
});
export type ProposeRateInput = z.infer<typeof ProposeRateInput>;
