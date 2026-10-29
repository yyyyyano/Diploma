// Выбор модели пользователем (llm_preferences, userOwnedTable): одна строка на пользователя; «Авто» — строки нет.
// Только через ScopedDb владельца: s.own на каждый запрос (ROLE-01).
import { and, eq } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { llmPreferences } from "./schema.ts";

/** Выбранная пользователем scope модель; «Авто» — undefined. */
export async function getPreferredModel(s: ScopedDb): Promise<string | undefined> {
  const rows = await s.db
    .select({ modelId: llmPreferences.modelId })
    .from(llmPreferences)
    .where(and(s.own(llmPreferences), eq(llmPreferences.userId, s.scope.userId)))
    .limit(1);
  return rows[0]?.modelId;
}

/** Запомнить выбор (заменяет прежний): одной транзакцией — две вкладки не оставят две строки. */
export async function setPreferredModel(s: ScopedDb, modelId: string): Promise<void> {
  await s.transaction(async (tx) => {
    await tx.delete(llmPreferences, eq(llmPreferences.userId, tx.scope.userId));
    await tx.insert(llmPreferences).values({ modelId });
  });
}

/** Вернуть «Авто». */
export async function clearPreferredModel(s: ScopedDb): Promise<void> {
  await s.delete(llmPreferences, eq(llmPreferences.userId, s.scope.userId));
}
