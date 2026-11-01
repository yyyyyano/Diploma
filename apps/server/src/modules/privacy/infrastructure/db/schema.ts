// Таблица privacy_consents (PRIV-01, PRIV-02, ARCHITECTURE §6.1): журнал согласий домохозяйства — userOwnedTable.
// Строки только добавляются: каждое решение (дал, отказался, отозвал) — новая строка с видом, ответом, версией текста
// и моментом (created_at); действует последняя строка вида. Так хранится факт и время согласия (99-З).
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { systemTable, userOwnedTable } from "../../../../platform/db/tables.ts";

/** Вид согласия: обработка ПД (PRIV-01), облачные модели (PRIV-02) или Telegram (PRIV-08). */
export const CONSENT_KINDS = ["personal-data", "cloud", "telegram"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const privacyConsents = userOwnedTable(
  "privacy_consents",
  {
    kind: text().$type<ConsentKind>().notNull(),
    granted: boolean().notNull(),
    textVersion: text().notNull(),
  },
  (t) => [
    check("privacy_consents_kind_check", sql`${t.kind} in ('personal-data', 'cloud', 'telegram')`),
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

/** Состояние архива «Мои данные»: собирается задачей, готов, не удался. */
export const EXPORT_STATUSES = ["pending", "ready", "failed"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/**
 * Архив «Мои данные» (PRIV-05): заявка и её итог. Сам архив — файл модуля files (вид data-export); ссылка — id файла
 * без внешнего ключа (таблицы чужого модуля privacy не видит), архив удаляется вместе со строкой, когда человек
 * просит новый. Строка нужна, чтобы вкладка показала «готовится», «готов: имя, размер» или «не удалось». Готовится
 * не больше одного архива на домохозяйство (частичный уникальный индекс): две заявки разом — одна задача сборки.
 */
export const privacyExports = userOwnedTable(
  "privacy_exports",
  {
    status: text().$type<ExportStatus>().notNull(),
    fileId: uuid(),
    fileName: text(),
    size: bigint({ mode: "number" }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("privacy_exports_status_check", sql`${t.status} in ('pending', 'ready', 'failed')`),
    uniqueIndex("privacy_exports_one_pending_idx")
      .on(t.householdId)
      .where(sql`${t.status} = 'pending'`),
  ],
);
