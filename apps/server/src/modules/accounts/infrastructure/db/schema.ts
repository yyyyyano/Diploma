// Таблицы accounts (STMT-01, STMT-02, ARCHITECTURE §6.1) — userOwnedTable. Счёт: вид, банк, маска (4 цифры), валюта,
// название (null — подпись по виду даёт сайт), начальный остаток, остаток и день, на который он известен, и откуда
// (указан вами, из выписки, по операциям). «Наличные» в BYN — одни у пользователя, «Карта, не указана» — одна у
// домохозяйства, карта банка с маской и валютой — одна (частичные уникальные индексы: двойная доставка события и
// параллельный импорт не создают второй счёт). Деньги — целые копейки (bigint) + валюта. Ревизия — состояние счёта до
// действия: по ней «Отменить» возвращает название и начальный остаток, в журнале — только её id.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ownedFk, userOwnedTable } from "../../../../platform/db/tables.ts";

export const accounts = userOwnedTable(
  "accounts",
  {
    kind: text().notNull(),
    name: text(),
    bank: text(),
    mask: text(),
    currency: text().notNull().default("BYN"),
    /** Начальный остаток (STMT-01), копейки. */
    initialBalanceMinor: bigint({ mode: "number" }).notNull().default(0),
    /** Остаток (STMT-02), копейки валюты счёта. */
    balanceMinor: bigint({ mode: "number" }).notNull().default(0),
    /** День, на который остаток известен; значение по умолчанию — только для строк до T-019. */
    balanceOn: date({ mode: "string" })
      .notNull()
      .default(sql`current_date`),
    balanceSource: text().notNull().default("manual"),
  },
  (t) => [
    check(
      "accounts_kind_check",
      sql`${t.kind} in ('cash', 'card', 'current', 'savings', 'deposit', 'unknown-card')`,
    ),
    check("accounts_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("accounts_mask_check", sql`${t.mask} is null or ${t.mask} ~ '^[0-9]{4}$'`),
    check(
      "accounts_balance_source_check",
      sql`${t.balanceSource} in ('manual', 'statement', 'operations')`,
    ),
    uniqueIndex("accounts_cash_per_user_idx")
      .on(t.householdId, t.userId)
      .where(sql`${t.kind} = 'cash' and ${t.currency} = 'BYN'`),
    uniqueIndex("accounts_unknown_card_idx")
      .on(t.householdId)
      .where(sql`${t.kind} = 'unknown-card'`),
    uniqueIndex("accounts_bank_mask_idx")
      .on(t.householdId, sql`lower(${t.bank})`, t.mask, t.currency)
      .where(sql`${t.mask} is not null`),
  ],
);

export const accountRevisions = userOwnedTable(
  "account_revisions",
  {
    accountId: uuid().notNull(),
    /** Счёта до действия не было: «Отменить» его удаляет. */
    existed: boolean().notNull(),
    name: text(),
    initialBalanceMinor: bigint({ mode: "number" }).notNull(),
  },
  (t) => [...ownedFk(t, t.accountId, accounts, { onDelete: "cascade" })],
);
