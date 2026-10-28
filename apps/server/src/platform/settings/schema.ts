// Таблица настроек системы (ADM-60, ARCHITECTURE §9): значение, заданное в админке, — JSON под ключом настройки.
// Вид — systemTable платформы: без домохозяйства, доступ только через SystemDb из platform/settings (решение T-005).
import { jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { systemTable } from "../db/tables.ts";

export const settings = systemTable("settings", {
  /** Ключ настройки: `clock.time-zone` (defineSetting). */
  key: text().primaryKey(),
  /** Значение из админки; проверяется схемой настройки при записи и при чтении. */
  value: jsonb().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull(),
});
