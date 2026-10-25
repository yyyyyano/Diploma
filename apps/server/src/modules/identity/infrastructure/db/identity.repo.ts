// Запросы к таблицам identity (systemTable модуля). db — SystemDb или s.db/tx.db: первый запуск пишет пользователя,
// домохозяйство и события в одной транзакции ScopedDb нового пользователя (ARCHITECTURE §6.4), а аудитор в режиме
// scoped проверяет только пользовательские таблицы — системные таблицы identity ему не мешают. Пользовательских
// таблиц здесь нет ни одной.
import type { HouseholdId, UserId } from "@kosht/kernel";
import { and, eq, sql } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { identityCredentials, identityHouseholds, identityUsers, systemState } from "./schema.ts";

/** Построитель запросов: SystemDb или db транзакции ScopedDb (SystemDb подходит под этот тип). */
export type IdentityDb = ScopedDb["db"];

/** Роль пользователя (ROLE-02): admin видит админку, но не чужие финансы (PRIV-07). */
export type UserRole = "user" | "admin";

/** Провайдер учётных данных Better Auth для входа по email и паролю. */
export const CREDENTIAL_PROVIDER = "credential";

/** Новые id пользователя и домохозяйства — uuidv7() базы: Scope нового пользователя нужен до транзакции. */
export async function newUserIds(
  db: IdentityDb,
): Promise<{ userId: UserId; householdId: HouseholdId }> {
  const rows = await db.execute<{ user_id: string; household_id: string }>(
    sql`select uuidv7() as user_id, uuidv7() as household_id`,
  );
  const row = rows.rows[0];
  if (row === undefined) throw new Error("uuidv7() не вернул строку.");
  return { userId: row.user_id as UserId, householdId: row.household_id as HouseholdId };
}

/** Система уже инициализирована (AUTH-10). */
export async function isInitialized(db: IdentityDb): Promise<boolean> {
  const rows = await db
    .select({ initialized: systemState.initialized })
    .from(systemState)
    .where(eq(systemState.id, 1));
  return rows[0]?.initialized === true;
}

/**
 * Перевести признак в «инициализирована», если он ещё не был: условный UPDATE берёт блокировку строки — второй
 * параллельный setup дождётся коммита первого и вернёт false.
 */
export async function claimInitialization(db: IdentityDb, at: Date): Promise<boolean> {
  const rows = await db
    .update(systemState)
    .set({ initialized: true, initializedAt: at })
    .where(and(eq(systemState.id, 1), eq(systemState.initialized, false)))
    .returning({ id: systemState.id });
  return rows.length === 1;
}

/** Домохозяйство, пользователь и его пароль (хэш argon2id) — три строки одной транзакции. */
export async function insertUser(
  db: IdentityDb,
  user: {
    readonly userId: UserId;
    readonly householdId: HouseholdId;
    readonly email: string;
    readonly role: UserRole;
    readonly passwordHash: string;
  },
): Promise<void> {
  await db.insert(identityHouseholds).values({ id: user.householdId });
  await db.insert(identityUsers).values({
    id: user.userId,
    name: "",
    email: user.email,
    role: user.role,
    householdId: user.householdId,
  });
  await db.insert(identityCredentials).values({
    accountId: user.userId,
    providerId: CREDENTIAL_PROVIDER,
    userId: user.userId,
    password: user.passwordHash,
  });
}

/** Домохозяйство пользователя (для сессии) или undefined. */
export async function householdOf(
  db: IdentityDb,
  userId: string,
): Promise<HouseholdId | undefined> {
  const rows = await db
    .select({ householdId: identityUsers.householdId })
    .from(identityUsers)
    .where(eq(identityUsers.id, userId));
  return rows[0]?.householdId as HouseholdId | undefined;
}

/** Пользователь существует, активен и состоит в этом домохозяйстве (перепроверка scope задачи). */
export async function isActiveMember(
  db: IdentityDb,
  candidate: { readonly userId: UserId; readonly householdId: HouseholdId },
): Promise<boolean> {
  const rows = await db
    .select({ id: identityUsers.id })
    .from(identityUsers)
    .where(
      and(
        eq(identityUsers.id, candidate.userId),
        eq(identityUsers.householdId, candidate.householdId),
        eq(identityUsers.status, "active"),
      ),
    );
  return rows.length === 1;
}
