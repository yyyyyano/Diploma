// Запросы к explanations: первый аргумент — s: ScopedDb, у каждого обращения свой s.own(explanations).
import type { LocalDate, Period, TraceNode } from "@kosht/kernel";
import { and, eq, inArray } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { StoredExplanation } from "../../domain/explanation.ts";
import { explanations } from "./schema.ts";

/**
 * Сохранить расчёты одним INSERT … ON CONFLICT DO NOTHING по (household_id, trace_hash): такой расчёт уже есть — берётся
 * его id, новая строка не растёт. Порядок id — как входных расчётов.
 */
export async function insertExplanations(
  s: ScopedDb,
  saved: readonly {
    readonly trace: TraceNode;
    readonly period: Period | undefined;
    readonly hash: string;
  }[],
  at: Date,
): Promise<string[]> {
  if (saved.length === 0) return [];
  const unique = [...new Map(saved.map((item) => [item.hash, item])).values()];
  await s
    .insert(explanations)
    .values(
      unique.map((item) => ({
        trace: item.trace,
        periodFrom: item.period?.from ?? null,
        periodTo: item.period?.to ?? null,
        traceHash: item.hash,
        createdAt: at,
        updatedAt: at,
      })),
    )
    .onConflictDoNothing({ target: [explanations.householdId, explanations.traceHash] });
  const rows = await s.db
    .select({ id: explanations.id, hash: explanations.traceHash })
    .from(explanations)
    .where(
      and(
        s.own(explanations),
        inArray(explanations.traceHash, [...new Map(unique.map((u) => [u.hash, u.hash])).keys()]),
      ),
    );
  const byHash = new Map(rows.map((row) => [row.hash, row.id]));
  return saved.map((item) => {
    const id = byHash.get(item.hash);
    if (id === undefined) throw new Error("explanations: строка после вставки не найдена.");
    return id;
  });
}

export async function findExplanation(
  s: ScopedDb,
  id: string,
): Promise<StoredExplanation | undefined> {
  const rows = await s.db
    .select()
    .from(explanations)
    .where(and(s.own(explanations), eq(explanations.id, id)));
  const row = rows[0];
  if (row === undefined) return undefined;
  const period =
    row.periodFrom === null || row.periodTo === null
      ? undefined
      : { from: row.periodFrom as LocalDate, to: row.periodTo as LocalDate };
  return { id: row.id, trace: row.trace, period, createdAt: row.createdAt };
}
