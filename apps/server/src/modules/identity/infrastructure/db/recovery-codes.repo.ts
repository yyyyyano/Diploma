// Код восстановления (AUTH-05) в identity_recovery_codes: один на пользователя, только хэш argon2id.
import { and, eq } from "drizzle-orm";
import type { UserStatus } from "./identity.repo.ts";
import type { IdentityDb } from "./identity.repo.ts";
import { identityRecoveryCodes, identityUsers } from "./schema.ts";

/** Записать новый код пользователя (прежний перестаёт действовать). */
export async function saveRecoveryCode(
  db: IdentityDb,
  userId: string,
  codeHash: string,
  at: Date,
): Promise<void> {
  await db
    .insert(identityRecoveryCodes)
    .values({ userId, codeHash, createdAt: at })
    .onConflictDoUpdate({ target: identityRecoveryCodes.userId, set: { codeHash, createdAt: at } });
}

/** Пользователь по email с хэшем его кода (если код есть). */
export async function recoveryTarget(
  db: IdentityDb,
  email: string,
): Promise<{ userId: string; status: UserStatus; codeHash: string | null } | undefined> {
  const rows = await db
    .select({
      userId: identityUsers.id,
      status: identityUsers.status,
      codeHash: identityRecoveryCodes.codeHash,
    })
    .from(identityUsers)
    .leftJoin(identityRecoveryCodes, eq(identityRecoveryCodes.userId, identityUsers.id))
    .where(eq(identityUsers.email, email));
  const row = rows[0];
  if (row === undefined) return undefined;
  return {
    userId: row.userId,
    status: row.status === "active" ? "active" : "blocked",
    codeHash: row.codeHash,
  };
}

/** Когда создан действующий код; кода нет — undefined. */
export async function recoveryCodeCreatedAt(
  db: IdentityDb,
  userId: string,
): Promise<Date | undefined> {
  const rows = await db
    .select({ createdAt: identityRecoveryCodes.createdAt })
    .from(identityRecoveryCodes)
    .where(eq(identityRecoveryCodes.userId, userId));
  return rows[0]?.createdAt;
}

/**
 * Погасить код, если он всё ещё тот, что сверили (T-017, находка ревью T-013): DELETE … WHERE code_hash = … в
 * транзакции восстановления. Второй запрос с тем же кодом ждёт строку первого и после его коммита ничего не находит —
 * проходит ровно один. false — код уже погашен или заменён.
 */
export async function consumeRecoveryCode(
  db: IdentityDb,
  userId: string,
  codeHash: string,
): Promise<boolean> {
  const rows = await db
    .delete(identityRecoveryCodes)
    .where(
      and(eq(identityRecoveryCodes.userId, userId), eq(identityRecoveryCodes.codeHash, codeHash)),
    )
    .returning({ userId: identityRecoveryCodes.userId });
  return rows.length > 0;
}
