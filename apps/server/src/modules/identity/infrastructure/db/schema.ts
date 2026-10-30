// Таблицы identity (ADR-0016, ARCHITECTURE §6.1): все — systemTable модуля. Четыре таблицы ядра Better Auth под
// своими именами (modelName): пользователи, сессии, учётные данные (account Better Auth: у нас — только пароль),
// токены подтверждения; плюс домохозяйства — граница изоляции (ROLE-01) — и синглтон первого запуска (AUTH-10).
// Колонки повторяют поля ядра Better Auth (имена свойств = имена полей, snake_case в базе); id — uuidv7() самой
// базы (generateId: false), моменты — timestamptz. household_id пользователя и сессии — владелец «по смыслу», но
// таблицы системные: читает их только identity (SystemDb), пользовательские данные лежат в userOwnedTable.
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { systemTable } from "../../../../platform/db/tables.ts";

const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);
const moment = () => timestamp({ withTimezone: true });

/** Домохозяйство: в MVP у каждого пользователя своё (задел DIP-03). */
export const identityHouseholds = systemTable("identity_households", {
  id: id(),
  createdAt: moment().notNull().defaultNow(),
});

/**
 * Пользователь Better Auth + свои поля: роль, статус (AUTH-11), демо (DEMO-04), домохозяйство, отметка сброса пароля
 * администратором (AUTH-05).
 */
export const identityUsers = systemTable(
  "identity_users",
  {
    id: id(),
    name: text().notNull(),
    email: text().notNull().unique(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    role: text().notNull().default("user"),
    status: text().notNull().default("active"),
    demo: boolean().notNull().default(false),
    householdId: uuid()
      .notNull()
      .references(() => identityHouseholds.id),
    /**
     * Когда администратор выдал себе ссылку сброса пароля этого пользователя (AUTH-05, R37: у него нет ни
     * подтверждённой почты, ни Telegram). Пользователь видит «Пароль был сброшен администратором <дата>» и гасит
     * отметку; null — не сбрасывался.
     */
    passwordResetByAdminAt: moment(),
    createdAt: moment().notNull().defaultNow(),
    updatedAt: moment().notNull().defaultNow(),
  },
  (t) => [
    check("identity_users_role_check", sql`${t.role} in ('user', 'admin')`),
    check("identity_users_status_check", sql`${t.status} in ('active', 'blocked')`),
    index("identity_users_household_id_idx").on(t.householdId),
  ],
);

/** Сессия: токен — в cookie kosht_session (подписан); домохозяйство — копия из пользователя при входе. */
export const identitySessions = systemTable(
  "identity_sessions",
  {
    id: id(),
    token: text().notNull().unique(),
    expiresAt: moment().notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: uuid()
      .notNull()
      .references(() => identityUsers.id, { onDelete: "cascade" }),
    householdId: uuid().notNull(),
    createdAt: moment().notNull().defaultNow(),
    updatedAt: moment().notNull().defaultNow(),
  },
  (t) => [index("identity_sessions_user_id_idx").on(t.userId)],
);

/** Учётные данные (account Better Auth): providerId «credential» — хэш пароля argon2id в password. */
export const identityCredentials = systemTable(
  "identity_credentials",
  {
    id: id(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => identityUsers.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: moment(),
    refreshTokenExpiresAt: moment(),
    scope: text(),
    password: text(),
    createdAt: moment().notNull().defaultNow(),
    updatedAt: moment().notNull().defaultNow(),
  },
  (t) => [index("identity_credentials_user_id_idx").on(t.userId)],
);

/** Токены подтверждения почты и сброса пароля (T-012, T-013). */
export const identityVerifications = systemTable(
  "identity_verifications",
  {
    id: id(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: moment().notNull(),
    createdAt: moment().notNull().defaultNow(),
    updatedAt: moment().notNull().defaultNow(),
  },
  (t) => [index("identity_verifications_identifier_idx").on(t.identifier)],
);

/**
 * Первый запуск (AUTH-10, ADR-0016): признак, а не «нет администраторов». Одна строка id = 1 (её вставляет
 * миграция); setup переводит initialized из false в true условным UPDATE — второй параллельный setup его не пройдёт.
 */
export const systemState = systemTable(
  "system_state",
  {
    id: integer().primaryKey(),
    initialized: boolean().notNull().default(false),
    initializedAt: moment(),
    /** Контакт оператора загрузчика законов с экрана первого запуска (AUTH-10, LAW-36); дальше им владеет legal-base. */
    loaderContact: text(),
  },
  (t) => [check("system_state_singleton_check", sql`${t.id} = 1`)],
);

/**
 * Код восстановления (AUTH-05): один на пользователя, только хэш argon2id (как пароль); после входа с кодом
 * заменяется новым. Отдельная таблица, а не поле пользователя: Better Auth читает пользователя целиком в сессию.
 */
export const identityRecoveryCodes = systemTable("identity_recovery_codes", {
  userId: uuid()
    .primaryKey()
    .references(() => identityUsers.id, { onDelete: "cascade" }),
  codeHash: text().notNull(),
  createdAt: moment().notNull(),
});
