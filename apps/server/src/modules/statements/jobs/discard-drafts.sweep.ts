// Ночной обход «брошенных черновиков» импорта: находит владельцев черновиков (предпросмотр или ошибка разбора), не
// тронутых больше суток, и ставит каждому задачу statements.discard-draft; возраст по настройке TTL проверяет задача.
import { and, inArray, lt, sql } from "drizzle-orm";
import { defineSweep, type SweepFind } from "../../../platform/jobs/sweep.ts";
import { statementImports } from "../infrastructure/db/schema.ts";
import type { discardDraftJob } from "./discard-draft.job.ts";

const findStaleDrafts: SweepFind = async (db) =>
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

export function discardDraftsSweep(job: ReturnType<typeof discardDraftJob>) {
  return defineSweep({
    name: "statements.discard-drafts",
    cron: "30 3 * * *",
    find: findStaleDrafts,
    job,
    payload: (row) => ({ importId: row.id }),
  });
}
