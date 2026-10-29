// Запросы к statement_formats: первый аргумент — s: ScopedDb, у каждого обращения свой s.own (ADR-0006).
import { and, eq, sql } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { ColumnSchema, SourceKind } from "../../domain/types.ts";
import { statementFormats } from "./schema.ts";

export interface FormatRow {
  readonly fingerprint: string;
  readonly sourceKind: SourceKind;
  readonly bank: string | null;
  readonly bankKey: string | null;
  readonly schema: ColumnSchema;
  readonly usedCount: number;
}

const columns = {
  fingerprint: statementFormats.fingerprint,
  sourceKind: statementFormats.sourceKind,
  bank: statementFormats.bank,
  bankKey: statementFormats.bankKey,
  schema: statementFormats.schema,
  usedCount: statementFormats.usedCount,
};

/** Запомненный формат по отпечатку; нет — undefined. */
export async function findFormat(s: ScopedDb, fingerprint: string): Promise<FormatRow | undefined> {
  const rows = await s.db
    .select(columns)
    .from(statementFormats)
    .where(and(s.own(statementFormats), eq(statementFormats.fingerprint, fingerprint)))
    .limit(1);
  return rows[0];
}

/** Запомненные форматы того же банка и вида файла — чтобы заметить, что формат банка изменился. */
export async function findFormatsOfBank(
  s: ScopedDb,
  bankKey: string,
  sourceKind: SourceKind,
): Promise<FormatRow[]> {
  return await s.db
    .select(columns)
    .from(statementFormats)
    .where(
      and(
        s.own(statementFormats),
        eq(statementFormats.bankKey, bankKey),
        eq(statementFormats.sourceKind, sourceKind),
      ),
    );
}

/** Запомнить формат: новый — вставка, тот же отпечаток — схема обновляется, счётчик растёт. */
export async function upsertFormat(
  s: ScopedDb,
  row: Omit<FormatRow, "usedCount">,
  at: Date,
): Promise<void> {
  await s
    .insert(statementFormats)
    .values({ ...row, lastUsedAt: at })
    .onConflictDoUpdate({
      target: [statementFormats.householdId, statementFormats.fingerprint],
      set: {
        schema: row.schema,
        bank: row.bank,
        bankKey: row.bankKey,
        usedCount: sql`${statementFormats.usedCount} + 1`,
        lastUsedAt: at,
        updatedAt: at,
      },
    });
}
