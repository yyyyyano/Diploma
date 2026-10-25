// Таблица accounts (STMT-01, ARCHITECTURE §6.1): счета домохозяйства — userOwnedTable. «Наличные» — у каждого
// пользователя одни: частичный уникальный индекс (household_id, user_id) по kind = 'cash' — двойная доставка события
// «пользователь заведён» не создаёт второй счёт. Название null — подпись по виду даёт сайт из словаря. Деньги —
// целые копейки (bigint) + валюта.
import { sql } from "drizzle-orm";
import { bigint, check, text, uniqueIndex } from "drizzle-orm/pg-core";
import { userOwnedTable } from "../../../../platform/db/tables.ts";

export const accounts = userOwnedTable(
  "accounts",
  {
    kind: text().notNull(),
    name: text(),
    currency: text().notNull().default("BYN"),
    /** Начальный остаток (STMT-01), копейки. */
    initialBalanceMinor: bigint({ mode: "number" }).notNull().default(0),
  },
  (t) => [
    check("accounts_kind_check", sql`${t.kind} in ('cash')`),
    check("accounts_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    uniqueIndex("accounts_cash_per_user_idx")
      .on(t.householdId, t.userId)
      .where(sql`${t.kind} = 'cash'`),
  ],
);
