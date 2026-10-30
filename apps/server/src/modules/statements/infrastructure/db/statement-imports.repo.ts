// Запросы к statement_imports (черновики и итоги импорта): первый аргумент — s: ScopedDb, у каждого обращения свой s.own.
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { InsertValue, Patch, ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { SweepFind } from "../../../../platform/jobs/sweep.ts";
import { statementImports } from "./schema.ts";

export type ImportRow = typeof statementImports.$inferSelect;
export type NewImport = InsertValue<typeof statementImports>;
export type ImportPatch = Patch<typeof statementImports>;

export async function insertImport(s: ScopedDb, value: NewImport): Promise<ImportRow> {
  const rows = await s.insert(statementImports).values(value).returning();
  const row = rows[0];
  if (row === undefined) throw new Error("statements: вставка импорта не вернула строку.");
  return row;
}

/** Импорт по id (свой); чужой и неизвестный — undefined. */
export async function findImport(s: ScopedDb, id: string): Promise<ImportRow | undefined> {
  const rows = await s.db
    .select()
    .from(statementImports)
    .where(and(s.own(statementImports), eq(statementImports.id, id)));
  return rows[0];
}

/** Тот же импорт под блокировкой строки: импорт и откат идут по очереди. */
export async function lockImport(s: ScopedDb, id: string): Promise<ImportRow | undefined> {
  const rows = await s.db
    .select()
    .from(statementImports)
    .where(and(s.own(statementImports), eq(statementImports.id, id)))
    .for("update");
  return rows[0];
}

/** Вкладка выписок: новые сверху; тело черновика (строки) в список не идёт. */
export async function listImports(
  s: ScopedDb,
): Promise<Omit<ImportRow, "payload" | "schemaOverride">[]> {
  const t = statementImports;
  return s.db
    .select({
      id: t.id,
      householdId: t.householdId,
      userId: t.userId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      fileId: t.fileId,
      status: t.status,
      method: t.method,
      sourceKind: t.sourceKind,
      bank: t.bank,
      mask: t.mask,
      currency: t.currency,
      periodFrom: t.periodFrom,
      periodTo: t.periodTo,
      found: t.found,
      newCount: t.newCount,
      duplicates: t.duplicates,
      doubtful: t.doubtful,
      skipped: t.skipped,
      balanceStatus: t.balanceStatus,
      balanceDifferenceMinor: t.balanceDifferenceMinor,
      formatChanged: t.formatChanged,
      warnings: t.warnings,
      errorCode: t.errorCode,
      accountId: t.accountId,
      undoToken: t.undoToken,
      balanceAdjustment: t.balanceAdjustment,
      importedAt: t.importedAt,
    })
    .from(t)
    .where(s.own(t))
    .orderBy(desc(t.createdAt), desc(t.id));
}

export async function updateImport(s: ScopedDb, id: string, patch: ImportPatch): Promise<void> {
  await s.update(statementImports, eq(statementImports.id, id)).set(patch);
}

export async function deleteImportRow(s: ScopedDb, id: string): Promise<void> {
  await s.delete(statementImports, eq(statementImports.id, id));
}

/** Сквозной поиск для обхода «брошенных черновиков»: владельцы предпросмотров и ошибок, не тронутых больше суток. */
export const findStaleDraftOwners: SweepFind = async (db) =>
  db
    .select({
      id: statementImports.id,
      householdId: statementImports.householdId,
      userId: statementImports.userId,
    })
    .from(statementImports)
    .where(
      and(
        inArray(statementImports.status, ["ready", "failed"]),
        lt(statementImports.updatedAt, sql`now() - interval '1 day'`),
      ),
    );
