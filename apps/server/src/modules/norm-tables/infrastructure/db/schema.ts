// Таблица ставок (TAX-03, ADM-11, LAW-33): «параметр → период → значение → источник → кто и когда подтвердил». Общая таблица
// (publicTable): числа нормы одинаковы для всех, читает их калькулятор через фасад модуля (только подтверждённые), пишет — админка.
// Строка — одна версия значения: правка подтверждённого значения создаёт новую строку `pending`, «Подтвердить» делает её
// `confirmed`, а прежнюю — `superseded`; отклонённое — `rejected`. История — сами строки.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { publicTable } from "../../../../platform/db/tables.ts";

export const RATE_STATUSES = ["pending", "confirmed", "superseded", "rejected"] as const;
export type RateStatus = (typeof RATE_STATUSES)[number];

export const normRates = publicTable(
  "norm_rates",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    /** Код параметра (`domain/params.ts`): `ndfl.std-deduction.base`. */
    param: text().notNull(),
    /** Период действия — календарные дни включительно; без конца — действует по сей день. */
    validFrom: date({ mode: "string" }).notNull(),
    validTo: date({ mode: "string" }),
    /** Копейки BYN или сотые доли процента (по единице параметра). */
    value: bigint({ mode: "number" }).notNull(),
    status: text().notNull(),
    /** Источник: акт pravo.by, ключ фрагмента (сам и вложенные — для сверки LAW-33), статья, пункт; либо адрес вне pravo.by. */
    sourceAct: text(),
    sourcePath: text(),
    sourceArticle: text(),
    sourcePoint: text(),
    sourceUrl: text(),
    /** Версия фрагмента, из которой взято число: пусто, пока акт не проиндексирован. */
    sourceVersionId: uuid(),
    /** `developer` — сверено разработчиком при реализации, `admin` — подтвердил администратор (кто именно, не хранится). */
    confirmedByKind: text(),
    confirmedOn: date({ mode: "string" }),
    /** Пометка «вероятное расхождение с новой редакцией» (LAW-33): когда замечено; значение само не менялось. */
    driftAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("norm_rates_param_idx").on(t.param, t.validFrom),
    uniqueIndex("norm_rates_confirmed_idx")
      .on(t.param, t.validFrom)
      .where(sql`${t.status} = 'confirmed'`),
    uniqueIndex("norm_rates_pending_idx")
      .on(t.param, t.validFrom)
      .where(sql`${t.status} = 'pending'`),
    check(
      "norm_rates_status_check",
      sql`${t.status} in ('pending','confirmed','superseded','rejected')`,
    ),
    check("norm_rates_value_check", sql`${t.value} >= 0`),
    check("norm_rates_period_check", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
    check(
      "norm_rates_confirmed_by_check",
      sql`${t.confirmedByKind} is null or ${t.confirmedByKind} in ('developer','admin')`,
    ),
  ],
);
