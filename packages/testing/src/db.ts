// Тестовая база (ARCHITECTURE §12, ADR-0007): своя база на каждый тестовый файл — клон шаблона, собранного
// миграциями сервера в globalSetup проекта int (apps/server/src/platform/db/__fixtures__/int-global-setup.ts).
// Пакет о миграциях не знает и apps/server не импортирует: он собирает шаблон переданной функцией, клонирует
// (CREATE DATABASE … TEMPLATE) и удаляет базы — только с префиксом test_, чтобы не тронуть рабочую.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import pg from "pg";
import { inject } from "vitest";

/** Подключение к служебной базе сервера (из неё создаются и удаляются test_*). */
export interface TestDbConnection {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

/** Что globalSetup передаёт тестовым файлам через provide/inject. */
export interface TestDbContext {
  readonly connection: TestDbConnection;
  /** Имя шаблона test_tpl_<отпечаток миграций>. */
  readonly template: string;
  /** Номер процесса запуска Vitest: по нему globalSetup узнаёт базы упавших прошлых запусков. */
  readonly runId: string;
}

declare module "vitest" {
  interface ProvidedContext {
    testDb: TestDbContext;
  }
}

export interface TestDb {
  readonly name: string;
  /** Пул к своей базе; закрывает его drop(). */
  readonly pool: pg.Pool;
  drop(): Promise<void>;
}

const PREFIX = "test_";
const TEMPLATE_PREFIX = "test_tpl_";

let created = 0;

/** Своя база для тестового файла: beforeAll — createTestDb(), afterAll — drop(). */
export async function createTestDb(context: TestDbContext = inject("testDb")): Promise<TestDb> {
  created += 1;
  const name = `${PREFIX}${context.runId}_${process.pid}_${created}`;
  // Стратегия по умолчанию (WAL_LOG): замер T-004 — медиана ≈29 мс против ≈77 мс у FILE_COPY (тот делает
  // контрольную точку).
  await withAdmin(context.connection, (client) =>
    client.query(`create database ${quote(name)} template ${quote(context.template)}`),
  );
  const pool = new pg.Pool({ ...context.connection, database: name, max: 4 });
  return {
    name,
    pool,
    drop: async () => {
      await pool.end();
      await dropDatabase(context.connection, name);
    },
  };
}

/**
 * Шаблон для отпечатка миграций: есть — переиспользуется (повторный make check не мигрирует заново), нет — база
 * собирается под временным именем функцией build и переименовывается. Шаблоны других отпечатков удаляются.
 */
export async function prepareTemplate(
  connection: TestDbConnection,
  fingerprint: string,
  build: (database: string) => Promise<void>,
): Promise<string> {
  const template = `${TEMPLATE_PREFIX}${fingerprint}`;
  const existing = await listTestDatabases(connection);
  for (const old of existing.filter((db) => db.startsWith(TEMPLATE_PREFIX) && db !== template)) {
    await dropDatabase(connection, old);
  }
  if (existing.includes(template)) return template;
  const building = `${PREFIX}build_${process.pid}`;
  await dropDatabase(connection, building);
  await withAdmin(connection, (client) => client.query(`create database ${quote(building)}`));
  await build(building);
  const renamed = await withAdmin(connection, async (client) => {
    try {
      await client.query(`alter database ${quote(building)} rename to ${quote(template)}`);
    } catch (error) {
      // Параллельный прогон успел собрать тот же шаблон (42P04): берём его, свою копию удаляем.
      if ((error as { code?: string }).code !== "42P04") throw error;
      return false;
    }
    // Шаблон только копируется: подключиться к нему и случайно изменить нельзя.
    await client.query(
      `alter database ${quote(template)} with is_template true allow_connections false`,
    );
    return true;
  });
  if (!renamed) await dropDatabase(connection, building);
  return template;
}

/** Удалить базы test_* запусков, процесса которых больше нет (упавший или прерванный прогон). */
export async function dropOrphans(connection: TestDbConnection): Promise<string[]> {
  const orphans = (await listTestDatabases(connection)).filter((db) => {
    const pid = /^test_(?:build_)?(\d+)(?:_|$)/.exec(db)?.[1];
    return pid !== undefined && !isAlive(Number(pid));
  });
  for (const db of orphans) await dropDatabase(connection, db);
  return orphans;
}

/** Отпечаток папки миграций: меняется любой файл — собирается новый шаблон. */
export function fingerprintDir(dir: string): string {
  const hash = createHash("sha256");
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).toSorted()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else hash.update(relative(dir, path)).update("\0").update(readFileSync(path)).update("\0");
    }
  };
  walk(dir);
  return hash.digest("hex").slice(0, 16);
}

/** Удалить базу test_*; рабочую (без префикса) — отказ. */
export async function dropDatabase(connection: TestDbConnection, name: string): Promise<void> {
  await withAdmin(connection, async (client) => {
    if (name.startsWith(TEMPLATE_PREFIX)) {
      await client
        .query(`alter database ${quote(name)} is_template false`)
        .catch((error: unknown) => {
          // База уже удалена другим прогоном — удалять нечего; любая другая ошибка — наружу.
          if ((error as { code?: string }).code !== "3D000") throw error;
        });
    }
    await client.query(`drop database if exists ${quote(name)} with (force)`);
  });
}

async function listTestDatabases(connection: TestDbConnection): Promise<string[]> {
  return withAdmin(connection, async (client) => {
    const result = await client.query<{ datname: string }>(
      "select datname from pg_database where datname like 'test\\_%' order by datname",
    );
    return result.rows.map((row) => row.datname);
  });
}

async function withAdmin<R>(
  connection: TestDbConnection,
  fn: (client: pg.Client) => Promise<R>,
): Promise<R> {
  const client = new pg.Client(connection);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Имя базы в кавычках; не test_* — ошибка ещё до запроса (ADR-0007: защита по префиксу). */
function quote(name: string): string {
  if (!/^test_\w+$/.test(name)) {
    throw new Error(`Тестовые базы — только test_* из букв, цифр и _, получено «${name}».`);
  }
  return `"${name}"`;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM — процесс есть, но чужой; ESRCH — процесса нет.
    return (error as { code?: string }).code === "EPERM";
  }
}
