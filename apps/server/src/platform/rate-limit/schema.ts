// Счётчики ограничения частоты (SEC-02, ADR-0016): окно на пару «правило + ключ». Ключ (email, user_id) хранится
// только HMAC-SHA-256 с ключом из мастер-ключа — простой хеш email подбирается словарём. Вид — systemTable
// платформы, доступ только из platform/rate-limit.
import { bytea, integer, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { systemTable } from "../db/tables.ts";

export const rateLimits = systemTable(
  "rate_limits",
  {
    /** Имя правила: `auth.login`. */
    rule: text().notNull(),
    keyHash: bytea().notNull(),
    /** Начало текущего окна (по Clock приложения). */
    windowStart: timestamp({ withTimezone: true }).notNull(),
    /** Попыток в окне, включая отклонённые. */
    count: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.rule, t.keyHash] })],
);
