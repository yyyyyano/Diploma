// Запросы к таблицам identity (systemTable модуля). db — SystemDb или s.db/tx.db: первый запуск пишет пользователя,
// домохозяйство и события в одной транзакции ScopedDb нового пользователя (ARCHITECTURE §6.4), а аудитор в режиме
// scoped проверяет только пользовательские таблицы — системные таблицы identity ему не мешают. Пользовательских
// таблиц здесь нет ни одной.
import type { HouseholdId, UserId } from "@kosht/kernel";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "../../../../platform/errors/app-error.ts";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import {
  identityCredentials,
  identityHouseholds,
  identitySessions,
  identityUsers,
  identityVerifications,
  systemState,
} from "./schema.ts";

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
/** Контакт загрузчика законов, заданный на первом запуске (LAW-36); системы нет или контакта нет — null. */
export async function readLoaderContact(db: IdentityDb): Promise<string | null> {
  const rows = await db
    .select({ contact: systemState.loaderContact })
    .from(systemState)
    .where(eq(systemState.id, 1));
  return rows[0]?.contact ?? null;
}

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
export async function claimInitialization(
  db: IdentityDb,
  at: Date,
  loaderContact: string,
): Promise<boolean> {
  const rows = await db
    .update(systemState)
    .set({ initialized: true, initializedAt: at, loaderContact })
    .where(and(eq(systemState.id, 1), eq(systemState.initialized, false)))
    .returning({ id: systemState.id });
  return rows.length === 1;
}

/**
 * Домохозяйство, пользователь и его пароль (хэш argon2id) — три строки одной транзакции. Email уже занят (в том числе
 * параллельной регистрацией) — EMAIL_TAKEN: вставка с ON CONFLICT DO NOTHING не обрывает транзакцию ошибкой базы.
 */
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
  const inserted = await db
    .insert(identityUsers)
    .values({
      id: user.userId,
      name: "",
      email: user.email,
      role: user.role,
      householdId: user.householdId,
    })
    .onConflictDoNothing({ target: identityUsers.email })
    .returning({ id: identityUsers.id });
  if (inserted.length === 0) throw new AppError("EMAIL_TAKEN");
  await db.insert(identityCredentials).values({
    accountId: user.userId,
    providerId: CREDENTIAL_PROVIDER,
    userId: user.userId,
    password: user.passwordHash,
  });
}

/** Статус пользователя (AUTH-11): активен или заблокирован администратором. */
export type UserStatus = "active" | "blocked";

/** Домохозяйство и статус пользователя (для новой сессии) или undefined. */
export async function sessionOwner(
  db: IdentityDb,
  userId: string,
): Promise<{ householdId: HouseholdId; status: UserStatus } | undefined> {
  const rows = await db
    .select({ householdId: identityUsers.householdId, status: identityUsers.status })
    .from(identityUsers)
    .where(eq(identityUsers.id, userId));
  const row = rows[0];
  if (row === undefined) return undefined;
  return {
    householdId: row.householdId as HouseholdId,
    status: row.status === "active" ? "active" : "blocked",
  };
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

/** Состояние пользователя для бота (AUTH-11): активен, заблокирован или такого (в этом домохозяйстве) нет. */
export type MemberState = "active" | "blocked" | "absent";

export async function memberState(
  db: IdentityDb,
  candidate: { readonly userId: UserId; readonly householdId: HouseholdId },
): Promise<MemberState> {
  const rows = await db
    .select({ status: identityUsers.status })
    .from(identityUsers)
    .where(
      and(
        eq(identityUsers.id, candidate.userId),
        eq(identityUsers.householdId, candidate.householdId),
      ),
    );
  const status = rows[0]?.status;
  return status === "active" || status === "blocked" ? status : "absent";
}

/** Карточка пользователя для каркаса сайта и настроек. */
export interface UserCard {
  readonly email: string;
  readonly name: string;
  readonly role: UserRole;
  readonly emailVerified: boolean;
}

/** Email, имя, роль и подтверждён ли адрес — для каркаса сайта; нет пользователя — undefined. */
export async function userCard(db: IdentityDb, userId: UserId): Promise<UserCard | undefined> {
  const rows = await db
    .select({
      email: identityUsers.email,
      name: identityUsers.name,
      role: identityUsers.role,
      emailVerified: identityUsers.emailVerified,
    })
    .from(identityUsers)
    .where(eq(identityUsers.id, userId));
  const row = rows[0];
  if (row === undefined) return undefined;
  return {
    email: row.email,
    name: row.name,
    role: row.role === "admin" ? "admin" : "user",
    emailVerified: row.emailVerified,
  };
}

/**
 * Статус пользователя под блокировкой строки (FOR UPDATE) — до конца транзакции: блокировка администратором не
 * проскочит между проверкой и записью. Пользователя нет — undefined.
 */
export async function lockUserStatus(
  db: IdentityDb,
  userId: string,
): Promise<UserStatus | undefined> {
  const rows = await db
    .select({ status: identityUsers.status })
    .from(identityUsers)
    .where(eq(identityUsers.id, userId))
    .for("update");
  const row = rows[0];
  if (row === undefined) return undefined;
  return row.status === "active" ? "active" : "blocked";
}

/** Есть ли пользователь с этим email (в нижнем регистре). */
export async function emailTaken(db: IdentityDb, email: string): Promise<boolean> {
  const rows = await db
    .select({ id: identityUsers.id })
    .from(identityUsers)
    .where(eq(identityUsers.email, email));
  return rows.length > 0;
}

/** Отметить адрес подтверждённым (AUTH-03); пользователя нет — false. */
export async function markEmailVerified(
  db: IdentityDb,
  userId: string,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(identityUsers)
    .set({ emailVerified: true, updatedAt: at })
    .where(eq(identityUsers.id, userId))
    .returning({ id: identityUsers.id });
  return rows.length === 1;
}

/** Пользователь по email (в нижнем регистре): id и статус; нет — undefined. */
export async function userByEmail(
  db: IdentityDb,
  email: string,
): Promise<{ userId: UserId; status: UserStatus } | undefined> {
  const rows = await db
    .select({ id: identityUsers.id, status: identityUsers.status })
    .from(identityUsers)
    .where(eq(identityUsers.email, email));
  const row = rows[0];
  if (row === undefined) return undefined;
  return { userId: row.id as UserId, status: row.status === "active" ? "active" : "blocked" };
}

/** Новый хэш пароля (сброс по ссылке или коду восстановления). */
export async function setPasswordHash(
  db: IdentityDb,
  userId: string,
  passwordHash: string,
  at: Date,
): Promise<void> {
  await db
    .update(identityCredentials)
    .set({ password: passwordHash, updatedAt: at })
    .where(
      and(
        eq(identityCredentials.userId, userId),
        eq(identityCredentials.providerId, CREDENTIAL_PROVIDER),
      ),
    );
}

/** Завершить все сессии пользователя (сброс пароля, блокировка — AUTH-11). Возвращает, сколько было. */
export async function deleteSessions(db: IdentityDb, userId: string): Promise<number> {
  const rows = await db
    .delete(identitySessions)
    .where(eq(identitySessions.userId, userId))
    .returning({ id: identitySessions.id });
  return rows.length;
}

/**
 * Активные администраторы под блокировкой строк (FOR UPDATE) до конца транзакции (AUTH-12): параллельная смена роли
 * или статуса другого администратора ждёт и затем видит уже изменённые строки — «последний админ» не теряется.
 */
export async function lockActiveAdmins(db: IdentityDb): Promise<string[]> {
  const rows = await db
    .select({ id: identityUsers.id })
    .from(identityUsers)
    .where(and(eq(identityUsers.role, "admin"), eq(identityUsers.status, "active")))
    .orderBy(identityUsers.id)
    .for("update");
  return rows.map((row) => row.id);
}

/** Сменить роль или статус пользователя; пользователя нет — false. */
export async function updateUserAccess(
  db: IdentityDb,
  userId: string,
  patch: { readonly role?: UserRole; readonly status?: UserStatus },
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(identityUsers)
    .set({ ...patch, updatedAt: at })
    .where(eq(identityUsers.id, userId))
    .returning({ id: identityUsers.id });
  return rows.length === 1;
}

/** Хэш пароля пользователя (вход по email и паролю) или undefined. */
export async function passwordHashOf(db: IdentityDb, userId: string): Promise<string | undefined> {
  const rows = await db
    .select({ password: identityCredentials.password })
    .from(identityCredentials)
    .where(
      and(
        eq(identityCredentials.userId, userId),
        eq(identityCredentials.providerId, CREDENTIAL_PROVIDER),
      ),
    );
  return rows[0]?.password ?? undefined;
}

/**
 * Удалить пользователя последним шагом удаления аккаунта (PRIV-06): ссылки из писем (identity_verifications —
 * value = id пользователя), пользователь (сессии, пароль, код восстановления — каскадом) и его домохозяйство, если в
 * нём больше никого нет. Пользователя уже нет — ничего не делает.
 */
export async function deleteUserRecords(
  db: IdentityDb,
  user: { readonly userId: string; readonly householdId: string },
): Promise<void> {
  await db.delete(identityVerifications).where(eq(identityVerifications.value, user.userId));
  await db.delete(identityUsers).where(eq(identityUsers.id, user.userId));
  const members = await db
    .select({ id: identityUsers.id })
    .from(identityUsers)
    .where(eq(identityUsers.householdId, user.householdId))
    .limit(1);
  if (members.length === 0) {
    await db.delete(identityHouseholds).where(eq(identityHouseholds.id, user.householdId));
  }
}

/** Строка списка «Пользователи» админки (ADM-30): только учётная запись — без данных домохозяйства (PRIV-07). */
export interface AccountRow {
  readonly id: UserId;
  readonly email: string;
  readonly registeredAt: Date;
  readonly emailVerified: boolean;
  readonly status: UserStatus;
  readonly role: UserRole;
  readonly demo: boolean;
}

/** Все пользователи по дате регистрации (старые сверху), не больше limit. */
export async function listAccounts(db: IdentityDb, limit: number): Promise<AccountRow[]> {
  const rows = await db
    .select({
      id: identityUsers.id,
      email: identityUsers.email,
      registeredAt: identityUsers.createdAt,
      emailVerified: identityUsers.emailVerified,
      status: identityUsers.status,
      role: identityUsers.role,
      demo: identityUsers.demo,
    })
    .from(identityUsers)
    .orderBy(identityUsers.createdAt, identityUsers.id)
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    id: row.id as UserId,
    status: row.status === "active" ? "active" : "blocked",
    role: row.role === "admin" ? "admin" : "user",
  }));
}

/** Учётная запись по id: домохозяйство, email, подтверждён ли он, роль и статус; нет — undefined. */
export async function accountOf(
  db: IdentityDb,
  userId: string,
): Promise<
  | {
      readonly householdId: HouseholdId;
      readonly email: string;
      readonly emailVerified: boolean;
      readonly role: UserRole;
      readonly status: UserStatus;
    }
  | undefined
> {
  const rows = await db
    .select({
      householdId: identityUsers.householdId,
      email: identityUsers.email,
      emailVerified: identityUsers.emailVerified,
      role: identityUsers.role,
      status: identityUsers.status,
    })
    .from(identityUsers)
    .where(eq(identityUsers.id, userId));
  const row = rows[0];
  if (row === undefined) return undefined;
  return {
    householdId: row.householdId as HouseholdId,
    email: row.email,
    emailVerified: row.emailVerified,
    role: row.role === "admin" ? "admin" : "user",
    status: row.status === "active" ? "active" : "blocked",
  };
}

/** Когда администратор сбросил пароль пользователя (AUTH-05); не сбрасывал или отметка погашена — null. */
export async function adminResetMarkOf(db: IdentityDb, userId: string): Promise<Date | null> {
  const rows = await db
    .select({ at: identityUsers.passwordResetByAdminAt })
    .from(identityUsers)
    .where(eq(identityUsers.id, userId));
  return rows[0]?.at ?? null;
}

/** Отметка «пароль сброшен администратором» (AUTH-05): поставить моментом или погасить (null). */
export async function setAdminResetMark(
  db: IdentityDb,
  userId: string,
  at: Date | null,
): Promise<void> {
  await db
    .update(identityUsers)
    .set({ passwordResetByAdminAt: at })
    .where(eq(identityUsers.id, userId));
}

/** Самый давний активный администратор: от его имени идут системные события общей базы (законы), у которых нет своего владельца. */
export async function firstActiveAdmin(
  db: IdentityDb,
): Promise<{ id: string; householdId: string } | undefined> {
  const rows = await db
    .select({ id: identityUsers.id, householdId: identityUsers.householdId })
    .from(identityUsers)
    .where(and(eq(identityUsers.role, "admin"), eq(identityUsers.status, "active")))
    .orderBy(identityUsers.createdAt, identityUsers.id)
    .limit(1);
  return rows[0];
}
