// Таблица currency_rates (STMT-09, ARCHITECTURE §6.1) — publicTable: курсы НБРБ общие для всех, пишет только fx-rates
// через SystemDb. Строка — курс валюты на запрошенный день: в выходной или до установки курса это последний
// установленный (rate_date раньше on_date). Курс — в десятитысячных BYN за scale единиц валюты (как в API НБРБ), без
// float. Имя не fx_rates: префикс fx_ занят тестовой схемой механизма изоляции (platform/db/__fixtures__).
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { publicTable } from "../../../../platform/db/tables.ts";

export const currencyRates = publicTable(
  "currency_rates",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    currency: text().notNull(),
    onDate: date({ mode: "string" }).notNull(),
    rateDate: date({ mode: "string" }).notNull(),
    rateE4: bigint("rate_e4", { mode: "number" }).notNull(),
    scale: integer().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    check("currency_rates_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("currency_rates_positive_check", sql`${t.rateE4} > 0 and ${t.scale} > 0`),
    uniqueIndex("currency_rates_currency_day_idx").on(t.currency, t.onDate),
  ],
);
