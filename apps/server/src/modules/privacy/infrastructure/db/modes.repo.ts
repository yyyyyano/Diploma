// Запросы к privacy_modes (systemTable privacy): режим пользователя для админки. db — построитель транзакции
// ScopedDb (запись вместе со строкой журнала согласий) или SystemDb; пользовательских таблиц здесь нет — аудитор
// пускает оба.
import { eq } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { privacyModes } from "./schema.ts";

/** Построитель запросов: db транзакции ScopedDb или SystemDb (он подходит под этот тип). */
export type ModesDb = ScopedDb["db"];

/** Записать текущий режим пользователя (новый или заменить). */
export async function saveMode(
  db: ModesDb,
  userId: string,
  cloud: boolean,
  at: Date,
): Promise<void> {
  await db
    .insert(privacyModes)
    .values({ userId, cloud, updatedAt: at })
    .onConflictDoUpdate({ target: privacyModes.userId, set: { cloud, updatedAt: at } });
}

/** Удалить режим пользователя (удаление аккаунта, PRIV-06). */
export async function deleteMode(db: ModesDb, userId: string): Promise<void> {
  await db.delete(privacyModes).where(eq(privacyModes.userId, userId));
}

/** Пользователи в облачном режиме (столбец «Режим ИИ» админки, ADM-30); строки нет — локальный. */
export async function cloudUsers(db: ModesDb): Promise<Set<string>> {
  const rows = await db
    .select({ userId: privacyModes.userId })
    .from(privacyModes)
    .where(eq(privacyModes.cloud, true));
  return new Set(rows.map((row) => row.userId));
}
