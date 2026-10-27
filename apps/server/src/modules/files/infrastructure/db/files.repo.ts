// Запросы к таблице files — только через ScopedDb владельца: s.own(files) в каждом запросе (ARCHITECTURE §6.3).
import type { FileId } from "@kosht/kernel";
import { and, asc, eq, ne } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { FileKind } from "../../domain/file-kind.ts";
import { files } from "./schema.ts";

export interface FileRow {
  readonly id: FileId;
  readonly kind: FileKind;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly createdAt: Date;
}

const columns = {
  id: files.id,
  kind: files.kind,
  name: files.name,
  mime: files.mime,
  size: files.size,
  createdAt: files.createdAt,
};

export async function insertFile(
  s: ScopedDb,
  row: Omit<FileRow, "createdAt">,
  at: Date,
): Promise<void> {
  await s.insert(files).values({ ...row, createdAt: at, updatedAt: at });
}

/** Файл домохозяйства по id; чужой или несуществующий — undefined (неотличимы). */
export async function findFile(s: ScopedDb, id: FileId): Promise<FileRow | undefined> {
  const rows = await s.db
    .select(columns)
    .from(files)
    .where(and(s.own(files), eq(files.id, id)));
  const row = rows[0];
  return row === undefined ? undefined : { ...row, id: row.id as FileId };
}

/** Удалить строку файла; была ли она. */
export async function deleteFile(s: ScopedDb, id: FileId): Promise<boolean> {
  const rows = await s.delete(files, eq(files.id, id)).returning({ id: files.id });
  return rows.length === 1;
}

/** Файлы домохозяйства, кроме вида `except` (архив «Мои данные» не кладётся в следующий архив), старые первыми. */
export async function listFiles(s: ScopedDb, except: FileKind): Promise<FileRow[]> {
  const rows = await s.db
    .select(columns)
    .from(files)
    .where(and(s.own(files), ne(files.kind, except)))
    .orderBy(asc(files.createdAt), asc(files.id));
  return rows.map((row) => ({ ...row, id: row.id as FileId }));
}
