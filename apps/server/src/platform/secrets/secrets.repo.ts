// Запросы к таблице secrets (systemTable платформы): только через SystemDb — каждый запрос проходит аудитор.
// Здесь только шифротекст: открытое значение до базы не доходит.
import { eq } from "drizzle-orm";
import type { SystemDb } from "../db/system-db.ts";
import { secrets } from "./schema.ts";

export interface SealedSecret {
  readonly iv: Buffer;
  readonly tag: Buffer;
  readonly ciphertext: Buffer;
}

export async function readSealed(db: SystemDb, name: string): Promise<SealedSecret | undefined> {
  const rows = await db
    .select({ iv: secrets.iv, tag: secrets.tag, ciphertext: secrets.ciphertext })
    .from(secrets)
    .where(eq(secrets.name, name));
  return rows[0];
}

export async function writeSealed(
  db: SystemDb,
  name: string,
  sealed: SealedSecret,
  at: Date,
): Promise<void> {
  await db
    .insert(secrets)
    .values({ name, ...sealed, updatedAt: at })
    .onConflictDoUpdate({ target: secrets.name, set: { ...sealed, updatedAt: at } });
}

export async function deleteSealed(db: SystemDb, name: string): Promise<void> {
  await db.delete(secrets).where(eq(secrets.name, name));
}
