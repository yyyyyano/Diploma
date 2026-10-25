// Таблица секретов (NFR-16, ADR-0016): ключи API, пароль SMTP, токен бота — зашифрованы AES-256-GCM ключом из
// secrets/master.key; открытого значения в базе нет. Вид — systemTable платформы, доступ только из platform/secrets.
import { bytea, text, timestamp } from "drizzle-orm/pg-core";
import { systemTable } from "../db/tables.ts";

export const secrets = systemTable("secrets", {
  /** Имя секрета (defineSecret): `llm.groq-key`; оно же — AAD шифра. */
  name: text().primaryKey(),
  /** Свежий 12-байтный IV на каждую запись. */
  iv: bytea().notNull(),
  /** Тег аутентичности GCM (16 байт): чужой ключ или порча — расшифровка не проходит. */
  tag: bytea().notNull(),
  ciphertext: bytea().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull(),
});
