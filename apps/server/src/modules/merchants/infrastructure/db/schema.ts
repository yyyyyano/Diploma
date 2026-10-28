// Справочник контрагентов РБ (STMT-06, CAT-03) — publicTable: общий для всех, пишет только merchants (сид — миграция).
// Контрагент — название для человека и код встроенной категории (глобальное правило категоризации); алиас — ключ
// очищенного описания из выписки («EVROTORG», «ЕВРООПТ»), по нему контрагент находится точно, похожие — pg_trgm.
import { sql } from "drizzle-orm";
import { index, text, uuid } from "drizzle-orm/pg-core";
import { publicTable } from "../../../../platform/db/tables.ts";

export const merchantDirectory = publicTable("merchant_directory", {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  name: text().notNull(),
  /** Код встроенной категории (system_categories.code) — глобальное правило CAT-03. */
  categoryCode: text(),
});

export const merchantAliases = publicTable(
  "merchant_aliases",
  {
    alias: text().primaryKey(),
    merchantId: uuid()
      .notNull()
      .references(() => merchantDirectory.id, { onDelete: "cascade" }),
  },
  (t) => [index("merchant_aliases_trgm_idx").using("gin", sql`${t.alias} gin_trgm_ops`)],
);
