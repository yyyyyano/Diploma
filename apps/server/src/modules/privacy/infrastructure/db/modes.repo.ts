// Запросы к privacy_modes (systemTable privacy): режим пользователя для админки. db — построитель транзакции
// ScopedDb (запись вместе со строкой журнала согласий) или SystemDb; пользовательских таблиц здесь нет — аудитор
// пускает оба.
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
