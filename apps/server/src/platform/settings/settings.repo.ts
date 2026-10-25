// Запросы к таблице settings (systemTable платформы): только через SystemDb — каждый запрос проходит аудитор.
import { eq } from "drizzle-orm";
import type { SystemDb } from "../db/system-db.ts";
import { settings } from "./schema.ts";

/** Значение из админки или undefined, если настройка не задана. */
export async function readStored(
  db: SystemDb,
  key: string,
): Promise<{ value: unknown } | undefined> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key));
  return rows[0];
}

/** Записать значение из админки (вставка или замена). */
export async function writeStored(
  db: SystemDb,
  key: string,
  value: unknown,
  at: Date,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updatedAt: at })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: at } });
}

/** Убрать значение из админки: действует env или умолчание. */
export async function deleteStored(db: SystemDb, key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}
