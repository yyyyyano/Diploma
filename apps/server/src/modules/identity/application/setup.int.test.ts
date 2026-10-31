// AUTH-10, ROLE-02: первый запуск на настоящем Postgres — администратор, домохозяйство и события в одной транзакции,
// признак system_state.initialized переводится один раз (повтор и параллельный второй — CONFLICT).
import type { Scope } from "@kosht/kernel";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import type { EventDef } from "../../../platform/events/define-event.ts";
import type { Events } from "../../../platform/events/events.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { isInitialized, readLoaderContact } from "../infrastructure/db/identity.repo.ts";
import { verifyPassword } from "../infrastructure/password.ts";
import { makePublishSystemEvent } from "./publish-system-event.ts";
import { makeSetup } from "./setup.ts";

let db: TestDb | undefined;
afterAll(async () => {
  await db?.drop();
});

/** Своя база на каждый тест: признак первого запуска — один на базу. */
beforeEach(async () => {
  await db?.drop();
  db = await createTestDb();
});

interface Published {
  readonly name: string;
  readonly payload: unknown;
  readonly scope: Scope;
}

function setupWith(events: Partial<Events> = {}) {
  if (db === undefined) throw new Error("нет базы");
  const pool = db.pool;
  const published: Published[] = [];
  const memory = memoryLogger();
  const setup = makeSetup({
    system: createSystemDb(pool),
    scoped: (scope) => createScopedDb(pool, scope),
    clock: new FakeClock("2026-10-25T09:00:00Z"),
    log: memory.log,
    issueRecoveryCode: async () => ({ code: "TEST-CODE-0000-0000" }),
    events: {
      publish: async (tx, event: EventDef, payload) => {
        published.push({ name: event.name, payload, scope: tx.scope });
      },
      ...events,
    },
  });
  return { setup, published, memory, system: createSystemDb(pool) };
}

async function users() {
  if (db === undefined) throw new Error("нет базы");
  return (
    await db.owner.query<{
      id: string;
      email: string;
      role: string;
      household_id: string;
      password: string;
    }>(
      `select u.id, u.email, u.role, u.household_id, c.password
       from identity_users u join identity_credentials c on c.user_id = u.id`,
    )
  ).rows;
}

const admin = { email: "Admin@Example.test", password: "надёжный-пароль-12" };

describe("AUTH-10: первый запуск", () => {
  it("создаёт администратора с домохозяйством, хэшем пароля и публикует два события с его id", async () => {
    const { setup, published, system, memory } = setupWith();
    expect(await setup(admin)).toEqual({ recoveryCode: "TEST-CODE-0000-0000" });
    const [user, ...rest] = await users();
    expect(rest).toEqual([]);
    expect(user).toMatchObject({ email: "admin@example.test", role: "admin" });
    expect(await verifyPassword({ hash: user?.password ?? "", password: admin.password })).toBe(
      true,
    );
    expect(await isInitialized(system)).toBe(true);
    expect(published.map((p) => [p.name, p.payload])).toEqual([
      ["identity.system-initialized", { ids: [user?.id] }],
      ["identity.user-registered", { ids: [user?.id] }],
    ]);
    // Владелец задач подписчиков — сам новый пользователь и его домохозяйство.
    expect(published[0]?.scope).toEqual({ userId: user?.id, householdId: user?.household_id });
    expect(memory.text()).not.toContain("example.test");
  });

  it("повторный setup после первого — CONFLICT, второго администратора нет", async () => {
    const { setup } = setupWith();
    await setup(admin);
    await expect(setup({ ...admin, email: "second@example.test" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await users()).map((u) => u.email)).toEqual(["admin@example.test"]);
  });

  it("два setup одновременно — ровно один проходит, второй получает CONFLICT", async () => {
    const { setup } = setupWith();
    const results = await Promise.allSettled([
      setup(admin),
      setup({ ...admin, email: "rival@example.test" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [failed] = results.filter((r) => r.status === "rejected");
    expect(failed?.reason).toMatchObject({ code: "CONFLICT" });
    expect(await users()).toHaveLength(1);
  });

  it("сбой публикации события откатывает всё: нет пользователя, система не инициализирована", async () => {
    const { setup, system } = setupWith({
      publish: async () => {
        throw new Error("очередь недоступна");
      },
    });
    await expect(setup(admin)).rejects.toThrow("очередь недоступна");
    expect(await users()).toEqual([]);
    expect(await isInitialized(system)).toBe(false);
  });

  it("LAW-36: контакт загрузчика законов по умолчанию — email администратора, в событие он не попадает", async () => {
    const { setup, published, system } = setupWith();
    await setup(admin);
    expect(await readLoaderContact(system)).toBe("admin@example.test");
    expect(JSON.stringify(published)).not.toContain("admin@example.test");
  });

  it("LAW-36: заданный на экране контакт сохраняется как есть", async () => {
    const { setup, system } = setupWith();
    await setup({ ...admin, loaderContact: "https://example.test/about" });
    expect(await readLoaderContact(system)).toBe("https://example.test/about");
  });

  it("publishSystemEvent: до первого запуска события нет; после — в транзакции первого активного администратора", async () => {
    if (db === undefined) throw new Error("нет базы");
    const { setup, system } = setupWith();
    const pool = db.pool;
    const published: { userId: string; ids: unknown }[] = [];
    const publishSystemEvent = makePublishSystemEvent({
      system,
      scoped: (scope) => createScopedDb(pool, scope),
      events: {
        publish: async (tx, _event, payload) => {
          published.push({ userId: tx.scope.userId, ids: payload });
        },
      },
    });
    const event = { name: "legal-base.act-updated" } as never;
    expect(await publishSystemEvent(event, ["a1"])).toBe(false);
    await setup(admin);
    expect(await publishSystemEvent(event, ["a1", "a2"])).toBe(true);
    expect(published).toEqual([{ userId: (await users())[0]?.id, ids: { ids: ["a1", "a2"] } }]);
  });
});
