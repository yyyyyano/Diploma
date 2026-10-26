// Запросы к explanations: первый аргумент — s: ScopedDb, у каждого обращения свой s.own(explanations).
import type { LocalDate, Period, TraceNode } from "@kosht/kernel";
import { and, eq } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { StoredExplanation } from "../../domain/explanation.ts";
import { explanations } from "./schema.ts";

export async function insertExplanation(
  s: ScopedDb,
  saved: { readonly trace: TraceNode; readonly period: Period | undefined },
  at: Date,
): Promise<string> {
  const rows = await s
    .insert(explanations)
    .values({
      trace: saved.trace,
      periodFrom: saved.period?.from ?? null,
      periodTo: saved.period?.to ?? null,
      createdAt: at,
      updatedAt: at,
    })
    .returning({ id: explanations.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("explanations: вставка не вернула id.");
  return id;
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
