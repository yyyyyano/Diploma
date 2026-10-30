// Таблицы budgets (BUD-01…07, ARCHITECTURE §6.1) — userOwnedTable. Лимит — месячный предел по категории (ключ
// `system:<код>` / `custom:<id>`, как у агрегатов операций) с переключателями уведомлений 80 и 100 %. Цель — сумма в
// BYN к сроку: копилка (`piggy`, прогресс — сумма взносов) или привязка к накопительному счёту / вкладу (`account`,
// прогресс — остаток счёта; счёт без FK — модуль чужой, удалённый счёт виден в чтении). Деньги — целые копейки.
// Уведомления одноразовые: `budget_alerts` — по строке на «лимит + ГГГГ-ММ + порог» (`2026-10:80`) и на цель
// (`50`, `100`, `behind:2026-10`); уникальный индекс + ON CONFLICT DO NOTHING в транзакции уведомления — повтор
// доставки или пересчёта не шлёт второе. Ревизия — поля «до» действия человека: по ней «Отменить».
import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, jsonb, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ownedFk, userOwnedTable } from "../../../../platform/db/tables.ts";

export const budgetLimits = userOwnedTable(
  "budget_limits",
  {
    categoryKey: text().notNull(),
    limitMinor: bigint({ mode: "number" }).notNull(),
    notifyAt80: boolean().notNull().default(true),
    notifyAt100: boolean().notNull().default(true),
  },
  (t) => [
    check("budget_limits_limit_check", sql`${t.limitMinor} > 0`),
    uniqueIndex("budget_limits_category_idx").on(t.householdId, t.userId, t.categoryKey),
  ],
);

export const budgetGoals = userOwnedTable(
  "budget_goals",
  {
    name: text().notNull(),
    kind: text().notNull(),
    targetMinor: bigint({ mode: "number" }).notNull(),
    deadline: date({ mode: "string" }).notNull(),
    /** Накопительный счёт или вклад цели «по счёту»; у копилки — null. */
    accountId: uuid(),
    /** День создания — начало равномерного графика (BUD-07). */
    createdOn: date({ mode: "string" }).notNull(),
  },
  (t) => [
    check("budget_goals_kind_check", sql`${t.kind} in ('piggy', 'account')`),
    check("budget_goals_target_check", sql`${t.targetMinor} > 0`),
    check(
      "budget_goals_account_check",
      sql`(${t.kind} = 'account') = (${t.accountId} is not null)`,
    ),
  ],
);

export const budgetContributions = userOwnedTable(
  "budget_contributions",
  {
    goalId: uuid().notNull(),
    amountMinor: bigint({ mode: "number" }).notNull(),
    madeOn: date({ mode: "string" }).notNull(),
  },
  (t) => [
    check("budget_contributions_amount_check", sql`${t.amountMinor} > 0`),
    ...ownedFk(t, t.goalId, budgetGoals, { onDelete: "cascade" }),
  ],
);

export const budgetAlerts = userOwnedTable(
  "budget_alerts",
  {
    subjectId: uuid().notNull(),
    alertKey: text().notNull(),
  },
  (t) => [
    uniqueIndex("budget_alerts_key_idx").on(t.householdId, t.userId, t.subjectId, t.alertKey),
  ],
);

export const budgetRevisions = userOwnedTable(
  "budget_revisions",
  {
    kind: text().notNull(),
    subjectId: uuid().notNull(),
    /** Лимита или цели до действия не было (создана): «Отменить» её убирает. */
    existed: boolean().notNull(),
    before: jsonb().$type<Record<string, string | number | boolean | null>>().notNull(),
  },
  (t) => [check("budget_revisions_kind_check", sql`${t.kind} in ('limit', 'goal')`)],
);
