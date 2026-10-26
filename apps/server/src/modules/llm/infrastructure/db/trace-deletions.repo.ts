// Очередь повторов удаления трасс Langfuse (llm_trace_deletions, systemTable llm): строки без домохозяйства —
// только SystemDb модуля.
import { asc, eq, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import { llmTraceDeletions } from "./schema.ts";

/** Поставить пользователя в очередь (повторная постановка — без дубля). */
export async function queueTraceDeletion(db: SystemDb, userId: string, at: Date): Promise<void> {
  await db
    .insert(llmTraceDeletions)
    .values({ userId, createdAt: at })
    .onConflictDoNothing({ target: llmTraceDeletions.userId });
}

/** Ожидающие удаления, старые первыми. */
export async function pendingTraceDeletions(db: SystemDb, limit: number): Promise<string[]> {
  const rows = await db
    .select({ userId: llmTraceDeletions.userId })
    .from(llmTraceDeletions)
    .orderBy(asc(llmTraceDeletions.createdAt), asc(llmTraceDeletions.userId))
    .limit(limit);
  return rows.map((row) => row.userId);
}

/** Трассы удалены — строка уходит из очереди. */
export async function completeTraceDeletion(db: SystemDb, userId: string): Promise<void> {
  await db.delete(llmTraceDeletions).where(eq(llmTraceDeletions.userId, userId));
}

/** Попытка не удалась — счётчик и момент попытки. */
export async function failTraceDeletion(db: SystemDb, userId: string, at: Date): Promise<void> {
  await db
    .update(llmTraceDeletions)
    .set({ attempts: sql`${llmTraceDeletions.attempts} + 1`, lastAttemptAt: at })
    .where(eq(llmTraceDeletions.userId, userId));
}
