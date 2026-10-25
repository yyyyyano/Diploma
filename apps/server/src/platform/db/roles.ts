// Роль приложения без суперпользователя (ADR-0020, ROLE-01, SEC-04, PRIV-07). Приложение ходит в базу ролью
// kosht_app: только DML на таблицах своих схем. Владелец базы и таблиц (kosht из compose.yaml, суперпользователь)
// только мигрирует и выдаёт права — здесь. Так замки ADR-0006 держатся ещё и на правах: SQL мимо аудитора не
// прочитает файлы сервера (pg_read_binary_file, lo_import, COPY … PROGRAM), не создаст таблицу или функцию, не
// увидит значения чужих строк в статистике планировщика (pg_stats) и не станет владельцем.
//
// ensureAppRole — на пуле владельца, после миграций, под той же pg_advisory_lock (одна выдача прав на базу).
// Роль общая для кластера, а блокировка — на базу: два процесса разных баз (тестовые базы, T-006) могут менять
// роль одновременно — тогда CREATE ROLE даёт 23505/42710, ALTER ROLE — XX000 «tuple concurrently updated». Поэтому
// роль меняется только когда атрибуты или пароль отличаются, а вся транзакция повторяется на этих кодах.
//
// Пароль не попадает в лог Postgres: в базу уходит готовый SCRAM-SHA-256 verifier (RFC 5803, формат pg_authid —
// https://www.postgresql.org/docs/18/catalog-pg-authid.html), а не пароль; запись команд в лог на время
// транзакции выключена (log_statement, log_min_error_statement, log_min_duration_*). В логи приложения пароль
// не пишется вовсе.
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import type { DbConfig } from "../config/config.ts";
import { readPasswordFile } from "./connection.ts";
import { withMigrationLock } from "./migrate.ts";

export interface AppRoleOptions {
  /** Имя роли приложения (пользователь из DATABASE_URL), по умолчанию kosht_app. */
  readonly appRole: string;
  /** Файл пароля роли приложения (DB_PASSWORD_FILE): им же подключается приложение. */
  readonly passwordFile: string;
  /** Схемы с таблицами приложения: public и pgboss (очередь задач). */
  readonly schemas: readonly string[];
}

/**
 * Схемы с таблицами приложения: на них роль приложения получает DML. pgboss — таблицы очереди задач (ADR-0008):
 * их создаёт владелец (platform/jobs/install.ts), а роль ставит, берёт и завершает задачи.
 */
export const APP_SCHEMAS: readonly string[] = ["public", "pgboss"];

/** Параметры ensureAppRole из подключения приложения: роль — пользователь DATABASE_URL, пароль — его файл. */
export function appRoleOptions(
  app: DbConfig,
  schemas: readonly string[] = APP_SCHEMAS,
): AppRoleOptions {
  return {
    appRole: decodeURIComponent(new URL(app.url).username),
    passwordFile: app.passwordFile,
    schemas,
  };
}

/** Ошибка роли приложения: в тексте — что не так и что делать, без значений переменных и паролей. */
export class AppRoleError extends Error {
  override readonly name = "AppRoleError";
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

function ident(name: string, what: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new RangeError(`${what}: ожидается имя из строчных латинских букв, цифр и _ (до 63).`);
  }
  return `"${name}"`;
}

/**
 * Выдача прав в текущей базе: доступ к схемам и DML на их таблицах — уже созданных (GRANT ON ALL) и будущих,
 * которые создаст владелец (ALTER DEFAULT PRIVILEGES FOR ROLE: действует только на объекты этой роли —
 * https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html). Без TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
 * (отзываются явно — лечит ручную выдачу); на схему drizzle (журнал миграций) прав нет. CREATE на public у PUBLIC
 * отозван явно (в PostgreSQL 15+ это умолчание, но база могла быть создана иначе). Статистика планировщика
 * (pg_stats, pg_stats_ext, pg_stats_ext_exprs) показывает частые значения колонок всех домохозяйств — закрыта.
 * Права хранятся в каталогах базы и копируются с ней: клон шаблона (тесты) получает их без повторной выдачи.
 * Текст входит в отпечаток тестового шаблона.
 */
export function appRoleGrants(options: {
  readonly appRole: string;
  readonly owner: string;
  readonly schemas: readonly string[];
}): string[] {
  const app = ident(options.appRole, "роль приложения");
  const owner = ident(options.owner, "владелец");
  const statements = [
    "revoke create on schema public from public",
    "revoke select on pg_catalog.pg_stats, pg_catalog.pg_stats_ext, pg_catalog.pg_stats_ext_exprs from public",
  ];
  for (const name of options.schemas) {
    const schema = ident(name, "схема");
    statements.push(
      `grant usage on schema ${schema} to ${app}`,
      `grant select, insert, update, delete on all tables in schema ${schema} to ${app}`,
      `revoke truncate, references, trigger, maintain on all tables in schema ${schema} from ${app}`,
      `grant usage on all sequences in schema ${schema} to ${app}`,
      `alter default privileges for role ${owner} in schema ${schema} grant select, insert, update, delete on tables to ${app}`,
      `alter default privileges for role ${owner} in schema ${schema} grant usage on sequences to ${app}`,
    );
  }
  return statements;
}

/** Атрибуты роли приложения: вход по паролю, никаких административных прав. */
const ATTRIBUTES = "login nosuperuser nocreatedb nocreaterole noreplication nobypassrls";

/** Коды гонки двух баз за общую роль: повторить транзакцию — во второй раз роль уже такая, как нужно. */
const RACE_CODES = new Set(["XX000", "23505", "42710", "40001", "40P01"]);
const ATTEMPTS = 5;

/** Создать или привести в порядок роль приложения и выдать ей права в базе пула владельца. */
export async function ensureAppRole(owner: pg.Pool, options: AppRoleOptions): Promise<void> {
  ident(options.appRole, "роль приложения");
  const password = readPasswordFile(options.passwordFile);
  if (!/^[\x21-\x7e]+$/.test(password)) {
    // SCRAM требует SASLprep; для печатных ASCII он ничего не меняет, а make init пишет hex.
    throw new AppRoleError(
      `Пароль роли приложения (${options.passwordFile}): только печатные символы ASCII без пробелов — удалите файл и выполните make init.`,
    );
  }
  await withMigrationLock(owner, async (client) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await client.query("begin");
        await syncRole(client, options, password);
        await client.query("commit");
        return;
      } catch (error) {
        try {
          await client.query("rollback");
        } catch {
          // Оборванное соединение: rollback бросает своё — наружу уходит исходная причина, без повтора.
          throw error;
        }
        const code = (error as { code?: unknown }).code;
        if (attempt >= ATTEMPTS || typeof code !== "string" || !RACE_CODES.has(code)) throw error;
      }
    }
  });
}

interface RoleRow {
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  rolcanlogin: boolean;
  rolpassword: string | null;
}

async function syncRole(
  client: pg.PoolClient,
  options: AppRoleOptions,
  password: string,
): Promise<void> {
  // До первой команды с паролем: SET LOCAL — отдельными запросами, иначе строка целиком уже записана в лог.
  for (const setting of [
    "log_statement = 'none'",
    "log_min_error_statement = 'panic'",
    "log_min_duration_statement = -1",
    "log_min_duration_sample = -1",
  ]) {
    await client.query(`set local ${setting}`);
  }
  const { rows: who } = await client.query<{ owner: string }>("select current_user as owner");
  const ownerName = who[0]?.owner ?? "";
  if (ownerName === options.appRole) {
    // Иначе ALTER ROLE … NOSUPERUSER снял бы права с владельца базы.
    throw new AppRoleError(
      "DATABASE_URL и MIGRATION_DATABASE_URL указывают на одну роль: приложению нужна своя роль без прав " +
        "владельца (ADR-0020) — выполните make init.",
    );
  }
  const role = ident(options.appRole, "роль приложения");
  const { rows } = await client.query<RoleRow>(
    `select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin, rolpassword
       from pg_catalog.pg_authid where rolname = $1`,
    [options.appRole],
  );
  const current = rows[0];
  if (current === undefined) {
    await client.query(`create role ${role} ${ATTRIBUTES} password '${scramVerifier(password)}'`);
  } else {
    const spoiled =
      current.rolsuper ||
      current.rolcreatedb ||
      current.rolcreaterole ||
      current.rolreplication ||
      current.rolbypassrls ||
      !current.rolcanlogin;
    if (spoiled) await client.query(`alter role ${role} ${ATTRIBUTES}`);
    if (!scramMatches(current.rolpassword, password)) {
      await client.query(`alter role ${role} password '${scramVerifier(password)}'`);
    }
  }
  for (const statement of appRoleGrants({ ...options, owner: ownerName })) {
    await client.query(statement);
  }
}

const ITERATIONS = 4096;

function scramKeys(password: string, salt: Buffer, iterations: number) {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  return {
    storedKey: createHash("sha256").update(clientKey).digest(),
    serverKey: createHmac("sha256", salted).update("Server Key").digest(),
  };
}

/** SCRAM-SHA-256$<итерации>:<соль>$<StoredKey>:<ServerKey> (base64) — как хранит pg_authid. */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16)): string {
  const { storedKey, serverKey } = scramKeys(password, salt, ITERATIONS);
  return `SCRAM-SHA-256$${String(ITERATIONS)}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

const VERIFIER = /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;

/** Сохранённый verifier соответствует паролю (с его солью и числом итераций). */
export function scramMatches(stored: string | null, password: string): boolean {
  const match = VERIFIER.exec(stored ?? "");
  if (match === null) return false;
  const [, iterations = "", salt = "", storedKey = "", serverKey = ""] = match;
  const keys = scramKeys(password, Buffer.from(salt, "base64"), Number(iterations));
  const expected = Buffer.concat([keys.storedKey, keys.serverKey]);
  const actual = Buffer.concat([
    Buffer.from(storedKey, "base64"),
    Buffer.from(serverKey, "base64"),
  ]);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Чем роль пула опаснее роли приложения: имена признаков, без значений. */
export type AppRoleProblem =
  | "superuser"
  | "createdb"
  | "createrole"
  | "replication"
  | "bypassrls"
  | "member-of-role"
  | "create-on-public";

const PROBLEM_TEXT: Record<AppRoleProblem, string> = {
  superuser: "суперпользователь",
  createdb: "CREATEDB",
  createrole: "CREATEROLE",
  replication: "REPLICATION",
  bypassrls: "BYPASSRLS",
  "member-of-role": "членство в другой роли",
  "create-on-public": "CREATE на схеме public",
};

/** Проверка роли, которой подключён пул (её же переиспользует make doctor, T-011). */
export async function appRoleProblems(pool: pg.Pool): Promise<AppRoleProblem[]> {
  const { rows } = await pool.query<Record<AppRoleProblem, boolean>>(
    `select r.rolsuper as "superuser", r.rolcreatedb as "createdb", r.rolcreaterole as "createrole",
            r.rolreplication as "replication", r.rolbypassrls as "bypassrls",
            exists (select 1 from pg_catalog.pg_auth_members m where m.member = r.oid) as "member-of-role",
            has_schema_privilege(r.oid, 'public', 'CREATE') as "create-on-public"
       from pg_catalog.pg_roles r where r.rolname = current_user`,
  );
  const row = rows[0];
  if (row === undefined) return [];
  return (Object.keys(PROBLEM_TEXT) as AppRoleProblem[]).filter((problem) => row[problem]);
}

/** Признаки, которые ensureAppRole не снимает: их выдали вручную, make init не поможет. */
const GRANTED_BY_HAND: readonly AppRoleProblem[] = ["member-of-role", "create-on-public"];

/** Что делать: атрибуты владельца — старый .env; членство и CREATE — ручная выдача, снимается revoke. */
function appRoleHint(problems: readonly AppRoleProblem[]): string {
  const hints: string[] = [];
  if (problems.some((problem) => !GRANTED_BY_HAND.includes(problem))) {
    hints.push(
      "Похоже, DATABASE_URL указывает на владельца базы (старый .env): выполните make init — он заменит " +
        "старые DATABASE_URL и DB_PASSWORD_FILE в .env — и перезапустите.",
    );
  }
  const revokes: string[] = [];
  if (problems.includes("member-of-role")) revokes.push("revoke <роль> from <роль приложения>");
  if (problems.includes("create-on-public")) {
    revokes.push("revoke create on schema public from <роль приложения>");
  }
  if (revokes.length > 0) {
    hints.push(
      `Эти права выданы вручную: снимите их владельцем в make db-shell (${revokes.join("; ")}) и перезапустите.`,
    );
  }
  return hints.join(" ");
}

/** Старт отказывает, если приложение подключено ролью с лишними правами (например, старый .env с владельцем). */
export async function assertAppRole(pool: pg.Pool): Promise<void> {
  const problems = await appRoleProblems(pool);
  if (problems.length === 0) return;
  throw new AppRoleError(
    `Роль приложения (DATABASE_URL) не должна иметь: ${problems.map((p) => PROBLEM_TEXT[p]).join(", ")}. ` +
      `Приложение работает под ролью без административных прав (ADR-0020). ${appRoleHint(problems)}`,
  );
}
