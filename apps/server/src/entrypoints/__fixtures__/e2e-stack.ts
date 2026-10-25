// Стенд e2e (make e2e, ARCHITECTURE §12): api и worker — настоящие точки входа на своей свежей базе (клон шаблона
// @kosht/testing/db из боевых миграций) и своём порту; сайт — сборка Vite из api (WEB_DIST_DIR). Рабочие 8140,
// make dev и дев-база kosht не трогаются. Окружение процессов — только своё (.env и переменные разработчика стенд не
// видит), модели — кассета chat/accounts в режиме replay. Остановка по SIGTERM/SIGINT (Playwright, gracefulShutdown): процессы — SIGTERM, затем база и временная
// папка удаляются; упавший стенд оставит базу test_<pid>_…, её уберёт dropOrphans следующего прогона.
//   node apps/server/src/entrypoints/__fixtures__/e2e-stack.ts <порт> <папка сайта>
import { createTestDb } from "@kosht/testing/db";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDbConfig } from "../../platform/config/config.ts";
import { prepareServerTemplate } from "../../platform/db/__fixtures__/test-template.ts";

const [portArg, siteArg] = process.argv.slice(2);
if (portArg === undefined || siteArg === undefined) {
  process.stderr.write("Использование: e2e-stack.ts <порт> <папка собранного сайта>\n");
  process.exit(2);
}

const context = await prepareServerTemplate();
const db = await createTestDb(context);
const dir = await mkdtemp(join(tmpdir(), "kosht-e2e-"));
const masterKey = join(dir, "master.key");
await writeFile(masterKey, randomBytes(32), { mode: 0o600 });
const files = loadDbConfig();
const { app, admin } = context;

const env: NodeJS.ProcessEnv = {
  PATH: process.env["PATH"] ?? "",
  DATABASE_URL: `postgres://${app.user}@${app.host}:${String(app.port)}/${db.name}`,
  DB_PASSWORD_FILE: resolve(files.app.passwordFile),
  MIGRATION_DATABASE_URL: `postgres://${admin.user}@${admin.host}:${String(admin.port)}/${db.name}`,
  MIGRATION_DB_PASSWORD_FILE: resolve(files.migration.passwordFile),
  MASTER_KEY_FILE: masterKey,
  DATA_DIR: join(dir, "data"),
  WEB_DIST_DIR: resolve(siteArg),
  LISTEN_LOCAL_HOST: "127.0.0.1",
  LISTEN_LOCAL_PORT: portArg,
  LISTEN_LAN_HOST: "127.0.0.1",
  LISTEN_LAN_PORT: "0",
  LOG_LEVEL: "info",
  // Модели — кассета чата с паузами записи (виден поток), без сети и ключей (NFR-11).
  LLM_MODE: "replay",
  LLM_CASSETTE: resolve("apps/server/src/modules/chat/api/__cassettes__/accounts.json"),
  LLM_CASSETTE_DELAYS: "1",
};

function start(role: "api" | "worker"): ChildProcess {
  const entry = fileURLToPath(new URL(`../${role}.ts`, import.meta.url));
  return spawn(process.execPath, [entry], { env, stdio: ["ignore", "inherit", "inherit"] });
}

// worker раньше api: миграции идут под общей блокировкой, а api откроет порт, только когда готов.
const children = [start("worker"), start("api")];
let stopping = false;

async function stop(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((done) => {
          if (child.exitCode !== null || child.signalCode !== null) return done();
          child.once("exit", () => done());
          child.kill("SIGTERM");
        }),
    ),
  );
  await db.drop();
  await rm(dir, { recursive: true, force: true });
  process.exit(code);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => void stop(0));
for (const child of children) {
  // Процесс стенда умер сам — стенд не работает: остальное останавливается, код 1.
  child.once("exit", () => void stop(1));
}
