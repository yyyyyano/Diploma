// Корень композиции на настоящем Postgres (ARCHITECTURE §3, §13 шаг 5): все 36 модулей создаются по порядку
// modules.ts с портами платформы, их схемы загружены статически (globSync не переживёт сборку в один .mjs), дерево
// процедур совпадает с контрактом, а очередь каждой роли знает задачи подписок — событие из api или bot доходит до
// подписчика в worker. Повторное имя в реестре — ошибка старта без брошенных соединений.
import { contract } from "@kosht/contract";
import type { ContractRouterClient } from "@orpc/contract";
import { createRouterClient } from "@orpc/server";
import { FileId, type Scope } from "@kosht/kernel";
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { MODULES } from "../../../../tooling/architecture/modules.ts";
import { topologicalOrder } from "../../../../tooling/gen/module-order.ts";
import { loadConfig, type AppConfig } from "../platform/config/config.ts";
import { loadProductionSchemas } from "../platform/db/__fixtures__/production-schemas.ts";
import { registeredTables } from "../platform/db/tables.ts";
import { defineEvent } from "../platform/events/define-event.ts";
import { defineSubscription } from "../platform/events/define-subscription.ts";
import { memoryLogger } from "../platform/logging/__fixtures__/memory-logger.ts";
import {
  defineModule,
  type ModuleDescriptor,
  type Platform,
  type SystemPlatform,
} from "../platform/module/define-module.ts";
import { defineRateRule } from "../platform/rate-limit/rate-limit.ts";
import { contractPaths, routerPaths } from "./__fixtures__/router-paths.ts";
import { compose, type Composition, type ProcessRole } from "./compose.ts";
import { createModules, type ModulePorts } from "./create-modules.ts";
import { RegistryError } from "./registries.ts";

let db: TestDb;
let dir: string;
let config: AppConfig;
const opened: Composition[] = [];

beforeAll(async () => {
  db = await createTestDb();
  dir = await mkdtemp(join(tmpdir(), "kosht-compose-"));
  const { app, admin } = inject("testDb");
  await writeFile(join(dir, "db_app_password"), app.password, { mode: 0o600 });
  await writeFile(join(dir, "db_password"), admin.password, { mode: 0o600 });
  await writeFile(join(dir, "master.key"), randomBytes(32), { mode: 0o600 });
  config = loadConfig({
    DATABASE_URL: `postgres://${app.user}@${app.host}:${String(app.port)}/${db.name}`,
    DB_PASSWORD_FILE: join(dir, "db_app_password"),
    MIGRATION_DATABASE_URL: `postgres://${admin.user}@${admin.host}:${String(admin.port)}/${db.name}`,
    MIGRATION_DB_PASSWORD_FILE: join(dir, "db_password"),
    MASTER_KEY_FILE: join(dir, "master.key"),
    // Тесты офлайн (NFR-11): трассы не уходят в Langfuse, даже если make init создал ключи.
    LANGFUSE_ENABLED: "false",
    DATA_DIR: join(dir, "data"),
  });
});

afterAll(async () => {
  for (const composition of opened) await composition.close();
  await db.drop();
  await rm(dir, { recursive: true, force: true });
});

async function start(
  role: ProcessRole,
  modules?: (ports: ModulePorts) => readonly ModuleDescriptor[],
): Promise<Composition> {
  const composition = await compose(config, role, {
    log: memoryLogger().log,
    ...(modules === undefined ? {} : { createModules: modules }),
  });
  opened.push(composition);
  return composition;
}

describe("повторное имя в реестре — ошибка старта", () => {
  it("два модуля с одним id: compose отказывает и закрывает свой пул роли приложения", async () => {
    // Тест идёт первым: других процессов bot в этой базе ещё нет, и после отказа соединений kosht-bot не остаётся.
    const connections = async () =>
      (
        await db.owner.query<{ n: number }>(
          "select count(*)::int as n from pg_stat_activity where datname = $1 and application_name = 'kosht-bot'",
          [db.name],
        )
      ).rows[0]?.n;
    await expect(
      compose(config, "bot", {
        log: memoryLogger().log,
        createModules: () => [defineModule({ id: "twin" }), defineModule({ id: "twin" })],
      }),
    ).rejects.toThrow(RegistryError);
    await vi.waitFor(async () => expect(await connections()).toBe(0));
  });
});

describe("ARCHITECTURE §3: 36 модулей в корне композиции", () => {
  let api: Composition;
  let ports: ModulePorts | undefined;

  beforeAll(async () => {
    api = await start("api", (given) => {
      ports = given;
      return createModules(given);
    });
  });

  it("модули созданы в порядке топологической сортировки modules.ts", () => {
    expect(api.modules.map((m) => m.id)).toEqual(topologicalOrder(MODULES).map((m) => m.id));
  });

  it("дерево процедур с ветками всех модулей совпадает с контрактом", () => {
    expect(routerPaths(api.router)).toEqual(contractPaths(contract));
  });

  it("схемы всех модулей загружены статически: glob по schema* не находит незагруженных таблиц", async () => {
    const loaded = [...registeredTables().keys()];
    expect(loaded).toEqual(expect.arrayContaining(["settings", "secrets", "background_job_run"]));
    await loadProductionSchemas();
    expect([...registeredTables().keys()]).toEqual(loaded);
  });

  it("порты платформы работают: файлы, секреты, лимиты частоты и ScopedDb из scope", async () => {
    const platform: Platform | undefined = ports?.platform;
    if (platform === undefined) throw new Error("createModules не вызван");
    const scope: Scope = testScope();
    const fileId = FileId.parse("0190f0a0-0000-7000-8000-0000000000aa");
    await platform.blobs.put(scope.householdId, fileId, new Uint8Array([1, 2, 3]));
    expect(await platform.blobs.get(scope.householdId, fileId)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await platform.secrets.status({ name: "compose.test-key" })).toBe("unset");
    const rule = defineRateRule({ name: "compose.test", limit: 1, windowMs: 60_000 });
    expect((await platform.rateLimiter.hit(rule, "a")).allowed).toBe(true);
    expect((await platform.rateLimiter.hit(rule, "a")).allowed).toBe(false);
    expect(platform.scoped(scope).scope).toBe(scope);
  });

  it("SystemDb — только в платформе модулей с таблицами system/public", () => {
    expect(ports?.platform).not.toHaveProperty("system");
    expect(ports?.platform).not.toHaveProperty("deriveKey");
    const systemPlatform: SystemPlatform | undefined = ports?.systemPlatform;
    expect(systemPlatform?.system).toBeDefined();
  });

  it("identity (первый модуль с таблицами system) получает SystemPlatform: процедура читает system_state", async () => {
    const client = createRouterClient(api.router, {
      context: {
        requestId: "compose-test",
        listener: "local",
        session: async () => undefined,
        shutdownSignal: new AbortController().signal,
      },
    }) as unknown as ContractRouterClient<typeof contract>;
    expect(await client.identity.status()).toEqual({ initialized: false, setupAvailable: true });
  });
});

describe("подписки и очереди во всех ролях", () => {
  const happened = defineEvent({
    name: "publisher.happened",
    payload: z.object({ ids: z.array(z.uuid()) }),
  });
  const received: { readonly ids: readonly string[]; readonly householdId: string }[] = [];
  let arrived: (count: number) => void = () => {};

  function testModules(): readonly ModuleDescriptor[] {
    return [
      defineModule({ id: "publisher", events: [happened] }),
      defineModule({
        id: "listener",
        subscriptions: [
          defineSubscription({
            event: happened,
            module: "listener",
            handle: async (ctx, payload) => {
              received.push({ ids: payload.ids, householdId: ctx.s.scope.householdId });
              arrived(received.length);
            },
          }),
        ],
      }),
    ];
  }

  it("событие, опубликованное в api и в bot, доходит до подписчика в worker", async () => {
    const [api, bot, worker] = [
      await start("api", testModules),
      await start("bot", testModules),
      await start("worker", testModules),
    ];
    // Владелец из конверта перепроверяется (ARCHITECTURE §6.4); источник — модуль identity (T-009).
    worker.scopes.register(async () => true);
    for (const composition of [api, bot, worker]) await composition.startJobs();
    const both = new Promise<void>((resolve) => {
      arrived = (count) => {
        if (count === 2) resolve();
      };
    });
    const scopeA = testScope({ user: 1, household: 1 });
    const scopeB = testScope({ user: 2, household: 2 });
    const idA = "0190f0a0-0000-7000-8000-0000000000a1";
    const idB = "0190f0a0-0000-7000-8000-0000000000b1";
    await api.platform
      .scoped(scopeA)
      .transaction((tx) => api.events.publish(tx, happened, { ids: [idA] }));
    await bot.platform
      .scoped(scopeB)
      .transaction((tx) => bot.events.publish(tx, happened, { ids: [idB] }));
    await both;
    expect(received.toSorted((a, b) => a.householdId.localeCompare(b.householdId))).toEqual([
      { ids: [idA], householdId: scopeA.householdId },
      { ids: [idB], householdId: scopeB.householdId },
    ]);
  }, 30_000);
});

describe("ARCHITECTURE §5: обработчики «Отменить» и «Да» — модулям поздним связыванием", () => {
  it("из фабрики модуля — ошибка; после сборки — реестры undo/confirm всех модулей", async () => {
    const undo = async () => {};
    const confirm = async () => {};
    let early: unknown;
    const composition = await start("bot", ({ platform }) => {
      try {
        platform.actionHandlers();
      } catch (error) {
        early = error;
      }
      return [
        defineModule({ id: "first", undo: { "first.add": undo } }),
        defineModule({ id: "second", confirm: { "second.delete": confirm } }),
      ];
    });
    expect(early).toBeInstanceOf(Error);
    const handlers = composition.platform.actionHandlers();
    expect([...handlers.undo.entries()]).toEqual([["first.add", undo]]);
    expect([...handlers.confirm.entries()]).toEqual([["second.delete", confirm]]);
  });
});
