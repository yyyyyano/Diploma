// Таблица files (SEC-03, RCPT-11, STMT-10, PRIV-05, ARCHITECTURE §6.1, §6.6): метаданные файлов домохозяйства —
// userOwnedTable. Сам файл лежит в хранилище по пути data/files/<householdId>/<id>, который строит сервер; имя
// файла из запроса — только метаданные (показ и имя при скачивании), в путь оно не попадает.
import { sql } from "drizzle-orm";
import { bigint, check, index, text } from "drizzle-orm/pg-core";
import { userOwnedTable } from "../../../../platform/db/tables.ts";
import type { FileKind } from "../../domain/file-kind.ts";

export const files = userOwnedTable(
  "files",
  {
    kind: text().$type<FileKind>().notNull(),
    name: text().notNull(),
    mime: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
  },
  (t) => [
    check("files_kind_check", sql`${t.kind} in ('data-export', 'receipt-photo', 'statement')`),
    check("files_size_check", sql`${t.size} >= 0`),
    index("files_kind_idx").on(t.householdId, t.kind, t.createdAt),
  ],
);
