// Заявки на архив «Мои данные» (privacy_exports) — только через ScopedDb владельца: s.own на каждый запрос.
import { and, desc, eq, sql } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { privacyExports, type ExportStatus } from "./schema.ts";

export interface ExportRow {
  readonly id: string;
  readonly status: ExportStatus;
  readonly fileId: string | null;
  readonly fileName: string | null;
  readonly size: number | null;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
}

const columns = {
  id: privacyExports.id,
  status: privacyExports.status,
  fileId: privacyExports.fileId,
  fileName: privacyExports.fileName,
  size: privacyExports.size,
  createdAt: privacyExports.createdAt,
  finishedAt: privacyExports.finishedAt,
};

/** Последняя заявка домохозяйства или undefined. */
export async function latestExport(s: ScopedDb): Promise<ExportRow | undefined> {
  const rows = await s.db
    .select(columns)
    .from(privacyExports)
    .where(s.own(privacyExports))
    .orderBy(desc(privacyExports.createdAt), desc(privacyExports.id))
    .limit(1);
  return rows[0];
}

export async function findExport(s: ScopedDb, id: string): Promise<ExportRow | undefined> {
  const rows = await s.db
    .select(columns)
    .from(privacyExports)
    .where(and(s.own(privacyExports), eq(privacyExports.id, id)));
  return rows[0];
}

/**
 * Удалить прежние заявки домохозяйства, кроме готовящейся с момента `staleBefore` и позже; id их архивов — чтобы
 * удалить и файлы. Свежую готовящуюся не трогаем: её могла закоммитить параллельная заявка уже после проверки
 * «готовится ли архив» — тогда вставка упрётся в privacy_exports_one_pending_idx и вернётся она (PRIV-05).
 */
export async function deleteExports(s: ScopedDb, staleBefore: Date): Promise<string[]> {
  const rows = await s
    .delete(
      privacyExports,
      sql`(${privacyExports.status} <> 'pending' or ${privacyExports.createdAt} < ${staleBefore})`,
    )
    .returning({ fileId: privacyExports.fileId });
  return rows.flatMap((row) => (row.fileId === null ? [] : [row.fileId]));
}

/** Новая заявка «готовится»; её id. */
export async function insertExport(s: ScopedDb, at: Date): Promise<string> {
  const rows = await s
    .insert(privacyExports)
    .values({ status: "pending", createdAt: at, updatedAt: at })
    .returning({ id: privacyExports.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("Заявка на архив не записалась.");
  return id;
}

/** Итог заявки: готов (с файлом) или не удался. */
export async function finishExport(
  s: ScopedDb,
  id: string,
  result:
    | {
        readonly status: "ready";
        readonly fileId: string;
        readonly fileName: string;
        readonly size: number;
      }
    | { readonly status: "failed" },
  at: Date,
): Promise<void> {
  await s
    .update(privacyExports, eq(privacyExports.id, id))
    .set({ ...result, finishedAt: at, updatedAt: at });
}

/**
 * Ошибка вставки — вторая готовящаяся заявка того же домохозяйства (privacy_exports_one_pending_idx): две заявки
 * пришли разом, первая уже поставила сборку. Код Postgres лежит в причине ошибки Drizzle.
 */
export function isSecondPending(error: unknown): boolean {
  for (let cause = error; typeof cause === "object" && cause !== null;) {
    const { code, constraint } = cause as { code?: unknown; constraint?: unknown };
    if (code === "23505" && constraint === "privacy_exports_one_pending_idx") return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}
