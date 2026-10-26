// Таблица privacy_consents (PRIV-01, PRIV-02, ARCHITECTURE §6.1): журнал согласий домохозяйства — userOwnedTable.
// Строки только добавляются: каждое решение (дал, отказался, отозвал) — новая строка с видом, ответом, версией текста
// и моментом (created_at); действует последняя строка вида. Так хранится факт и время согласия (99-З).
import { sql } from "drizzle-orm";
import { boolean, check, index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { systemTable, userOwnedTable } from "../../../../platform/db/tables.ts";

/** Вид согласия: обработка ПД (PRIV-01) или облачные модели (PRIV-02). */
export const CONSENT_KINDS = ["personal-data", "cloud"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const privacyConsents = userOwnedTable(
  "privacy_consents",
  {
    kind: text().$type<ConsentKind>().notNull(),
    granted: boolean().notNull(),
    textVersion: text().notNull(),
  },
  (t) => [
    check("privacy_consents_kind_check", sql`${t.kind} in ('personal-data', 'cloud')`),
    index("privacy_consents_kind_idx").on(t.householdId, t.userId, t.kind, t.createdAt),
  ],
);

/**
 * Текущий режим пользователя — облачный или локальный (PRIV-02, PRIV-07, SPEC §6.5): копия последнего облачного
 * решения журнала для столбца «режим» в админке (T-017). systemTable: админка читает её без доступа к журналу
 * согласий домохозяйства. Пишется в той же транзакции, что и строка журнала; удаляется с пользователем (PRIV-06).
 * Строки нет — локальный режим (облачного согласия не было).
 */
export const privacyModes = systemTable("privacy_modes", {
  userId: uuid().primaryKey(),
  cloud: boolean().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull(),
});
