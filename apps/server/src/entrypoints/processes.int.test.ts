// Три процесса по-настоящему (ARCHITECTURE §3, ADR-0015): дочерний node запускает точку входа так же, как make dev
// (Node 26 стирает типы сам, workspace-пакеты — по realpath, ADR-0002), на своей тестовой базе, с временными
// DATA_DIR и мастер-ключом и портами 0. Порт api читается из строки http.listening лога. Обе роли базы (ADR-0020) —
// явно: приложение kosht_app (DATABASE_URL) и владелец для миграций и выдачи прав (MIGRATION_*).
import { readSse, type SseEvent } from "@kosht/testing";
import { createTestDb, dropTestRole, testRoleName, type TestDb } from "@kosht/testing/db";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { MIGRATION_LOCK } from "../platform/db/migrate.ts";
import { APP_SCHEMAS, ensureAppRole } from "../platform/db/roles.ts";

type Role = "api" | "worker" | "bot";

const ENTRY: Record<Role, string> = {
  // api — с медленным маршрутом /slow: боевой api.ts тестовыми маршрутами не нагружается.
  api: fileURLToPath(new URL("./__fixtures__/slow-api.ts", import.meta.url)),
  worker: fileURLToPath(new URL("./worker.ts", import.meta.url)),
  bot: fileURLToPath(new URL("./bot.ts", import.meta.url)),
};

const CRASH_WORKER = fileURLToPath(new URL("./__fixtures__/crash-worker.ts", import.meta.url));

/** Запуск процесса с миграциями и WASM-аудитором — секунды; ждём с запасом. */
const START_MS = 20_000;
const TEST_MS = 40_000;

let db: TestDb;
let dir: string;
let passwordFile: string;
let ownerPasswordFile: string;
let masterKeyFile: string;
/** Роли test_*, которые портят тесты этого файла. */
const roles: string[] = [];

beforeAll(async () => {
  db = await createTestDb();
  dir = await mkdtemp(join(tmpdir(), "kosht-processes-"));
  passwordFile = join(dir, "db_app_password");
  ownerPasswordFile = join(dir, "db_password");
  masterKeyFile = join(dir, "master.key");
  await writeFile(passwordFile, inject("testDb").app.password, { mode: 0o600 });
  await writeFile(ownerPasswordFile, inject("testDb").admin.password, { mode: 0o600 });
  await writeFile(masterKeyFile, randomBytes(32), { mode: 0o600 });
});

afterAll(async () => {
  await db.drop();
  // Права ролей test_* живут в базе файла: роли удаляются после неё.
  for (const role of roles) await dropTestRole(inject("testDb").admin, role);
  await rm(dir, { recursive: true, force: true });
});

interface Started {
  readonly child: ChildProcess;
  readonly dataDir: string;
  readonly exited: Promise<number | null>;
  stdout(): string;
  stderr(): string;
}

let runs = 0;

async function start(
  role: Role,
  env: Record<string, string> = {},
  entry: string = ENTRY[role],
  args: readonly string[] = [],
): Promise<Started> {
  runs += 1;
  const dataDir = join(dir, `${role}-${runs}`);
  const { app, admin } = inject("testDb");
  const child = spawn(process.execPath, [entry, ...args], {
    // Окружение — только своё: .env и переменные разработчика тест не видит.
    env: {
      PATH: process.env["PATH"] ?? "",
      DATABASE_URL: `postgres://${app.user}@${app.host}:${String(app.port)}/${db.name}`,
      DB_PASSWORD_FILE: passwordFile,
      MIGRATION_DATABASE_URL: `postgres://${admin.user}@${admin.host}:${String(admin.port)}/${db.name}`,
      MIGRATION_DB_PASSWORD_FILE: ownerPasswordFile,
      MASTER_KEY_FILE: masterKeyFile,
      DATA_DIR: dataDir,
      WEB_DIST_DIR: join(dir, "no-site"),
      LISTEN_LOCAL_PORT: "0",
      LISTEN_LAN_HOST: "127.0.0.1",
      LISTEN_LAN_PORT: "0",
      LOG_LEVEL: "info",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    out += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    err += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  return { child, dataDir, exited, stdout: () => out, stderr: () => err };
}

/** Строки лога роли с диска (файл pino-roll в DATA_DIR/logs). */
async function logLines(dataDir: string, role: Role): Promise<Record<string, unknown>[]> {
  const logs = join(dataDir, "logs");
  const files = (await readdir(logs).catch(() => [])).filter((name) => name.startsWith(`${role}.`));
  const texts = await Promise.all(
    files.toSorted().map(async (name) => readFile(join(logs, name), "utf8")),
  );
  return texts
    .join("")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitForLog(started: Started, role: Role, msg: string) {
  return vi.waitFor(
    async () => {
      const line = (await logLines(started.dataDir, role)).find((entry) => entry["msg"] === msg);
      if (line === undefined) throw new Error(`нет строки ${msg}; stderr: ${started.stderr()}`);
      return line;
    },
    { timeout: START_MS, interval: 50 },
  );
}

/**
 * Соединения процесса с тестовой базой по имени пула: kosht-<роль> — роль приложения, kosht-<роль>-migrate —
 * владелец на старте. Смотрит владелец: чужие сессии роли приложению не видны.
 */
async function connections(name: string): Promise<number> {
  const result = await db.owner.query<{ n: number }>(
    "select count(*)::int as n from pg_stat_activity where application_name = $1 and datname = $2",
    [name, db.name],
  );
  return result.rows[0]?.n ?? -1;
}

describe("ADR-0015: api останавливается по SIGTERM корректно", () => {
  it(
    "запрос в полёте доведён, новые соединения отвергаются, соединений с БД нет, код 0, последняя строка — process.stopped",
    async () => {
      const api = await start("api");
      const listening = await waitForLog(api, "api", "http.listening");
      expect(listening).toMatchObject({ listener: "local" });
      const base = `http://127.0.0.1:${String(listening["port"])}`;
      await waitForLog(api, "api", "process.started");

      expect((await fetch(`${base}/readyz`)).status).toBe(200);
      expect(await (await fetch(`${base}/api/system/health`)).json()).toEqual({ status: "ok" });
      expect(await connections("kosht-api")).toBeGreaterThan(0);
      // ADR-0020: работает роль приложения, соединения владельца закрыты ещё в compose().
      const users = await db.owner.query<{ usename: string }>(
        "select distinct usename from pg_stat_activity where application_name = 'kosht-api' and datname = $1",
        [db.name],
      );
      expect(users.rows).toEqual([{ usename: inject("testDb").app.user }]);
      await vi.waitFor(async () => expect(await connections("kosht-api-migrate")).toBe(0), {
        interval: 20,
      });

      const inFlight = fetch(`${base}/slow`);
      await vi.waitFor(() => expect(api.stdout()).toContain("slow-started"), { interval: 20 });
      api.child.kill("SIGTERM");
      await waitForLog(api, "api", "process.stopping");
      await vi.waitFor(
        async () => {
          await expect(
            fetch(`${base}/healthz`, { headers: { connection: "close" } }),
          ).rejects.toThrow("fetch failed");
        },
        { interval: 20 },
      );

      const response = await inFlight;
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ done: true });
      expect(await api.exited).toBe(0);
      const apiLines = (await logLines(api.dataDir, "api")).map((line) => line["msg"]);
      expect(apiLines.slice(-2)).toEqual(["db.closed", "process.stopped"]);
      // Пароли ролей БД в лог приложения не попадают (NFR-16, OBS-04).
      const logText = JSON.stringify(await logLines(api.dataDir, "api"));
      expect(logText).not.toContain(inject("testDb").app.password);
      expect(logText).not.toContain(inject("testDb").admin.password);
      // Сервер закрывает соединение чуть позже клиента: ждём, пока backend исчезнет из pg_stat_activity.
      await vi.waitFor(async () => expect(await connections("kosht-api")).toBe(0), {
        interval: 50,
      });
    },
    TEST_MS,
  );

  it(
    "занятый локальный порт — понятное сообщение, код не 0, соединений с БД не осталось",
    async () => {
      const blocker: Server = createServer();
      await new Promise<void>((done) => blocker.listen(0, "127.0.0.1", done));
      const address = blocker.address();
      const port = address !== null && typeof address === "object" ? address.port : 0;
      try {
        const api = await start("api", { LISTEN_LOCAL_PORT: String(port) });
        const code = await api.exited;
        expect(code).not.toBe(0);
        expect(api.stderr()).toContain(`127.0.0.1:${String(port)}`);
        expect(api.stderr()).toContain("LISTEN_LOCAL_PORT");
        expect(await connections("kosht-api")).toBe(0);
      } finally {
        await new Promise((done) => blocker.close(done));
      }
    },
    TEST_MS,
  );
});

describe("ADR-0015, ADR-0008: api с открытым events.stream останавливается по SIGTERM", () => {
  it(
    "поток получает сигнал и заканчивается событием done; код 0 меньше чем за 10 с; realtime.stopped до db.closed; соединения LISTEN нет",
    async () => {
      const api = await start("api");
      const listening = await waitForLog(api, "api", "http.listening");
      const base = `http://127.0.0.1:${String(listening["port"])}`;
      await waitForLog(api, "api", "process.started");
      // ADR-0008: одно соединение LISTEN на процесс api, роль приложения.
      expect(await connections("kosht-api-listen")).toBe(1);

      // Сессия — настоящая (identity): первый запуск на локальном входе и вход по cookie kosht_session.
      const credentials = JSON.stringify({
        email: "admin@example.test",
        password: "пароль-для-sigterm",
      });
      const json = { "content-type": "application/json" };
      expect(
        (
          await fetch(`${base}/api/identity/setup`, {
            method: "POST",
            headers: json,
            body: credentials,
          })
        ).status,
      ).toBe(200);
      const signIn = await fetch(`${base}/api/identity/sign-in`, {
        method: "POST",
        headers: json,
        body: credentials,
      });
      const cookie = signIn.headers.getSetCookie()[0]?.split(";")[0] ?? "";
      const { rows } = await db.owner.query<{ household_id: string }>(
        "select household_id from identity_users",
      );
      const householdId = rows[0]?.household_id;

      const response = await fetch(`${base}/api/events/stream`, {
        headers: { cookie, accept: "text/event-stream" },
      });
      expect(response.status).toBe(200);
      if (response.body === null) throw new Error("у ответа нет тела");
      const events = readSse(response.body);
      const next = async (): Promise<SseEvent> => {
        const { value, done } = await events.next();
        if (done) throw new Error("поток закончился без события done");
        return value;
      };
      // Первый комментарий — поток уже в хабе: процедура открывает его до ответа.
      expect(await next()).toEqual({ comment: true });
      const id = "0190f0a0-0000-7000-8000-000000000001";
      await db.owner.query("select pg_notify('kosht_realtime', $1)", [
        JSON.stringify({
          householdId,
          type: "changed",
          entity: "receipt",
          ids: [id],
        }),
      ]);
      let event = await next();
      while (event.comment === true) event = await next();
      expect(event).toEqual({
        event: "message",
        data: JSON.stringify({ type: "changed", entity: "receipt", id }),
      });

      const stopping = Date.now();
      api.child.kill("SIGTERM");
      event = await next();
      while (event.comment === true) event = await next();
      expect(event).toEqual({ event: "done", data: '"closed"' });
      expect(await api.exited).toBe(0);
      expect(Date.now() - stopping).toBeLessThan(10_000);
      const lines = (await logLines(api.dataDir, "api")).map((line) => line["msg"]);
      expect(lines.slice(-2)).toEqual(["db.closed", "process.stopped"]);
      expect(lines.indexOf("realtime.stopped")).toBeGreaterThan(-1);
      expect(lines.indexOf("realtime.stopped")).toBeLessThan(lines.indexOf("db.closed"));
      await vi.waitFor(
        async () => {
          expect(await connections("kosht-api-listen")).toBe(0);
          expect(await connections("kosht-api")).toBe(0);
        },
        { interval: 50 },
      );
    },
    TEST_MS,
  );
});

describe("ADR-0020: api с лишними правами роли БД не стартует", () => {
  it.each([
    ["членство в pg_read_server_files", "grant pg_read_server_files to", "членство в другой роли"],
    ["CREATE на схеме public", "grant create on schema public to", "CREATE на схеме public"],
  ])(
    "%s — понятный отказ без паролей, код не 0, соединений с БД нет",
    async (_name, grant, problem) => {
      // Своя роль test_*: kosht_app общая для кластера, на ней идут остальные файлы. ensureAppRole не снимает
      // членство и явную выдачу CREATE — их ловит только assertAppRole в compose().
      const role = testRoleName();
      roles.push(role);
      const password = randomBytes(16).toString("hex");
      const rolePasswordFile = join(dir, role);
      await writeFile(rolePasswordFile, password, { mode: 0o600 });
      await ensureAppRole(db.owner, {
        appRole: role,
        passwordFile: rolePasswordFile,
        schemas: APP_SCHEMAS,
      });
      await db.owner.query(`${grant} "${role}"`);
      const { app } = inject("testDb");

      const api = await start("api", {
        DATABASE_URL: `postgres://${role}@${app.host}:${String(app.port)}/${db.name}`,
        DB_PASSWORD_FILE: rolePasswordFile,
      });
      expect(await api.exited).not.toBe(0);
      expect(api.stderr()).toContain(problem);
      expect(api.stderr()).toContain("revoke");
      const lines = await logLines(api.dataDir, "api");
      expect(lines.map((line) => line["msg"])).toContain("process.start-failed");
      const text = api.stderr() + JSON.stringify(lines);
      for (const secret of [password, inject("testDb").admin.password]) {
        expect(text).not.toContain(secret);
      }
      await vi.waitFor(
        async () => {
          expect(await connections("kosht-api")).toBe(0);
          expect(await connections("kosht-api-migrate")).toBe(0);
        },
        { interval: 50 },
      );
    },
    TEST_MS,
  );
});

describe.each<Role>(["worker", "bot"])(
  "ADR-0015: %s живёт до SIGTERM и останавливается корректно",
  (role) => {
    it(
      "старт с миграциями и очередью, остановка меньше чем за 10 с: код 0, process.stopped последней строкой, соединений с БД нет",
      async () => {
        const proc = await start(role);
        await waitForLog(proc, role, "db.migrated");
        await waitForLog(proc, role, "jobs.started");
        await waitForLog(proc, role, "process.started");
        expect(proc.child.exitCode).toBeNull();
        expect(await connections(`kosht-${role}`)).toBeGreaterThan(0);
        // ADR-0008: очередь pg-boss работает на пуле процесса — своих соединений у неё нет.
        const names = await db.owner.query<{ name: string }>(
          "select distinct application_name as name from pg_stat_activity where usename = $1 and datname = $2",
          [inject("testDb").app.user, db.name],
        );
        expect(names.rows).toEqual([{ name: `kosht-${role}` }]);

        const stopping = Date.now();
        proc.child.kill("SIGTERM");
        expect(await proc.exited).toBe(0);
        expect(Date.now() - stopping).toBeLessThan(10_000);
        const lines = (await logLines(proc.dataDir, role)).map((line) => line["msg"]);
        expect(lines.slice(-2)).toEqual(["db.closed", "process.stopped"]);
        await vi.waitFor(async () => expect(await connections(`kosht-${role}`)).toBe(0), {
          interval: 50,
        });
      },
      TEST_MS,
    );
  },
);

describe("OBS-05: необработанная ошибка роняет процесс с записью в логе", () => {
  it.each([
    ["exception", "uncaughtException"],
    ["rejection", "unhandledRejection"],
  ])(
    "%s — последняя строка process.crashed со стеком, код 1",
    async (mode, reason) => {
      const proc = await start("worker", {}, CRASH_WORKER, [mode]);
      expect(await proc.exited).toBe(1);
      const last = (await logLines(proc.dataDir, "worker")).at(-1);
      expect(last).toMatchObject({ level: "fatal", msg: "process.crashed", reason });
      expect(JSON.stringify(last?.["err"])).toContain("crash-worker.ts");
    },
    TEST_MS,
  );
});

describe("ADR-0015: SIGTERM во время миграций", () => {
  it(
    "старт доводится, роль не запускается: process.stopped последней строкой, код 0, соединений нет",
    async () => {
      // Блокировку миграций держит тест: процесс встаёт на ней — сигнал приходит ровно посреди миграций.
      const holder = await db.owner.connect();
      try {
        await holder.query("select pg_advisory_lock($1, $2)", [...MIGRATION_LOCK]);
        const proc = await start("worker");
        await vi.waitFor(
          async () => {
            const { rows } = await db.owner.query<{ n: number }>(
              "select count(*)::int as n from pg_stat_activity where application_name = $1 and datname = $2 and wait_event_type = 'Lock'",
              ["kosht-worker-migrate", db.name],
            );
            expect(rows[0]?.n).toBe(1);
          },
          { timeout: START_MS, interval: 50 },
        );
        proc.child.kill("SIGTERM");
        await waitForLog(proc, "worker", "process.stop-requested");
        await holder.query("select pg_advisory_unlock($1, $2)", [...MIGRATION_LOCK]);
        expect(await proc.exited).toBe(0);
        const lines = (await logLines(proc.dataDir, "worker")).map((line) => line["msg"]);
        expect(lines).not.toContain("process.started");
        expect(lines).not.toContain("jobs.started");
        expect(lines.slice(-2)).toEqual(["db.closed", "process.stopped"]);
        await vi.waitFor(async () => expect(await connections("kosht-worker")).toBe(0), {
          interval: 50,
        });
      } finally {
        holder.release();
      }
    },
    TEST_MS,
  );
});
