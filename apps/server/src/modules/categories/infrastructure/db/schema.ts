// Таблицы categories (CAT-01…03, CAT-05, ARCHITECTURE §6.1). Общие (publicTable, сид — миграция): встроенные
// категории и глобальные правила (ключевые слова в описании, в наименовании позиции, MCC). Домохозяйства
// (userOwnedTable): свои категории, скрытые встроенные (строка настроек домохозяйства — встроенная только скрывается),
// правила пользователя (контрагент или позиция → категория: встроенная по коду или своя по id — ровно одна, CHECK).
// «Смешанных» таблиц нет: общее и своё лежат раздельно.
import { sql } from "drizzle-orm";
import { boolean, check, integer, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ownedFk, publicTable, userOwnedTable } from "../../../../platform/db/tables.ts";

export const systemCategories = publicTable(
  "system_categories",
  {
    code: text().primaryKey(),
    kind: text().notNull(),
    icon: text().notNull(),
    color: text().notNull(),
    sort: integer().notNull(),
  },
  (t) => [check("system_categories_kind_check", sql`${t.kind} in ('expense', 'income')`)],
);

export const globalCategoryRules = publicTable(
  "global_category_rules",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    /** keyword — слово в описании операции, item — в наименовании позиции, mcc — код MCC. */
    matcher: text().notNull(),
    pattern: text().notNull(),
    categoryCode: text()
      .notNull()
      .references(() => systemCategories.code),
  },
  (t) => [
    check("global_category_rules_matcher_check", sql`${t.matcher} in ('keyword', 'item', 'mcc')`),
    uniqueIndex("global_category_rules_pattern_idx").on(t.matcher, t.pattern),
  ],
);

export const categories = userOwnedTable(
  "categories",
  {
    name: text().notNull(),
    kind: text().notNull(),
    icon: text().notNull(),
    color: text().notNull(),
    hidden: boolean().notNull().default(false),
  },
  (t) => [
    check("categories_kind_check", sql`${t.kind} in ('expense', 'income')`),
    uniqueIndex("categories_name_idx").on(t.householdId, t.kind, sql`lower(${t.name})`),
  ],
);

export const hiddenSystemCategories = userOwnedTable(
  "hidden_system_categories",
  {
    code: text()
      .notNull()
      .references(() => systemCategories.code),
  },
  (t) => [uniqueIndex("hidden_system_categories_code_idx").on(t.householdId, t.code)],
);

export const categoryRules = userOwnedTable(
  "category_rules",
  {
    /** merchant — ключ очищенного описания контрагента, item — нормализованное наименование позиции. */
    matcher: text().notNull(),
    pattern: text().notNull(),
    systemCode: text().references(() => systemCategories.code),
    categoryId: uuid(),
  },
  (t) => [
    check("category_rules_matcher_check", sql`${t.matcher} in ('merchant', 'item')`),
    check(
      "category_rules_one_category_check",
      sql`num_nonnulls(${t.systemCode}, ${t.categoryId}) = 1`,
    ),
    uniqueIndex("category_rules_pattern_idx").on(t.householdId, t.matcher, t.pattern),
    ...ownedFk(t, t.categoryId, categories, { onDelete: "cascade" }),
  ],
);
