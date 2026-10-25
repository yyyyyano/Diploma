// Три процесса по-настоящему (ARCHITECTURE §3, ADR-0015): дочерний node запускает точку входа так же, как make dev
// (Node 26 стирает типы сам, workspace-пакеты — по realpath, ADR-0002), на своей тестовой базе, с временными
// DATA_DIR и мастер-ключом и портами 0. Порт api читается из строки http.listening лога.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

type Role = "api" | "worker" | "bot";

const ENTRY: Record<Role, string> = {
  // api — с медленным маршрутом /slow: боевой api.ts тестовыми маршрутами не нагружается.
  api: fileURLToPath(new URL("./__fixtures__/slow-api.ts", import.meta.url)),
  worker: fileURLToPath(new URL("./worker.ts", import.meta.url)),
  bot: fileURLToPath(new URL("./bot.ts", import.meta.url)),
};

/** Запуск процесса с миграциями и WASM-аудитором — секунды; ждём с запасом. */
const START_MS = 20_000;
const TEST_MS = 40_000;

let db: TestDb;
let dir: string;
let passwordFile: string;
let masterKeyFile: string;

beforeAll(async () => {
  db = await createTestDb();
  dir = await mkdtemp(join(tmpdir(), "kosht-processes-"));
  passwordFile = join(dir, "db_password");
  masterKeyFile = join(dir, "master.key");
  await writeFile(passwordFile, inject("testDb").connection.password, { mode: 0o600 });
  await writeFile(masterKeyFile, randomBytes(32), { mode: 0o600 });
});

afterAll(async () => {
  await db.drop();
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

async function start(role: Role, env: Record<string, string> = {}): Promise<Started> {
  runs += 1;
  const dataDir = join(dir, `${role}-${runs}`);
  const { host, port, user } = inject("testDb").connection;
  const child = spawn(process.execPath, [ENTRY[role]], {
    // Окружение — только своё: .env и переменные разработчика тест не видит.
    env: {
      PATH: process.env["PATH"] ?? "",
      DATABASE_URL: `postgres://${user}@${host}:${String(port)}/${db.name}`,
      DB_PASSWORD_FILE: passwordFile,
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

/** Соединения процесса с тестовой базой (по имени процесса в пуле: kosht-<роль>). */
async function connections(role: Role): Promise<number> {
  const result = await db.pool.query<{ n: number }>(
    "select count(*)::int as n from pg_stat_activity where application_name = $1 and datname = $2",
    [`kosht-${role}`, db.name],
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
      expect(await connections("api")).toBeGreaterThan(0);

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
      // Сервер закрывает соединение чуть позже клиента: ждём, пока backend исчезнет из pg_stat_activity.
      await vi.waitFor(async () => expect(await connections("api")).toBe(0), { interval: 50 });
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
        expect(await connections("api")).toBe(0);
      } finally {
        await new Promise((done) => blocker.close(done));
      }
    },
    TEST_MS,
  );
});

describe.each<Role>(["worker", "bot"])(
  "ADR-0015: %s живёт до SIGTERM и останавливается корректно",
  (role) => {
    it(
      "старт с миграциями, остановка: код 0, process.stopped последней строкой, соединений с БД нет",
      async () => {
        const proc = await start(role);
        await waitForLog(proc, role, "db.migrated");
        await waitForLog(proc, role, "process.started");
        expect(proc.child.exitCode).toBeNull();
        expect(await connections(role)).toBeGreaterThan(0);

        proc.child.kill("SIGTERM");
        expect(await proc.exited).toBe(0);
        const lines = (await logLines(proc.dataDir, role)).map((line) => line["msg"]);
        expect(lines.slice(-2)).toEqual(["db.closed", "process.stopped"]);
        await vi.waitFor(async () => expect(await connections(role)).toBe(0), { interval: 50 });
      },
      TEST_MS,
    );
  },
);
