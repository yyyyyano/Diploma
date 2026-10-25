// Канал kosht_realtime на настоящем Postgres под ролью приложения (ADR-0008, ADR-0020): соединение LISTEN, его
// потеря и сигналы pg_notify через ScopedDb. Ожидание — промис, который разрешает обработчик (без sleep);
// «сигнала нет» доказывает барьер: следующий сигнал-«часовой» дошёл, а пропущенного перед ним не было.
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { appDbConfig, type AppDbConfig } from "./__fixtures__/app-db-config.ts";
import { listenConnector, notify, REALTIME_CHANNEL, type ListenConnection } from "./listen.ts";
import { createScopedDb } from "./scoped-db.ts";
import { createSystemDb } from "./system-db.ts";

let db: TestDb;
let app: AppDbConfig;
const open: ListenConnection[] = [];

beforeAll(async () => {
  db = await createTestDb();
  app = appDbConfig(db);
});
afterAll(async () => {
  for (const connection of open) await connection.close();
  await db.drop();
  app.cleanup();
});

/** Принятые сообщения и ожидание нужного. */
function inbox() {
  const received: string[] = [];
  const waiters: { payload: string; resolve: () => void }[] = [];
  let lost: (error: unknown) => void = () => {};
  const lostPromise = new Promise<unknown>((resolve) => {
    lost = resolve;
  });
  return {
    received,
    lost: lostPromise,
    handlers: {
      onNotification(payload: string) {
        received.push(payload);
        for (const waiter of waiters.filter((entry) => entry.payload === payload)) waiter.resolve();
      },
      onLost: (error: unknown) => lost(error),
    },
    until(payload: string): Promise<void> {
      if (received.includes(payload)) return Promise.resolve();
      return new Promise((resolve) => waiters.push({ payload, resolve }));
    },
  };
}

async function listen(name: string, handlers: ReturnType<typeof inbox>["handlers"]) {
  const connection = await listenConnector(app.config, name)(handlers);
  open.push(connection);
  return connection;
}

async function connections(name: string): Promise<{ usename: string }[]> {
  const { rows } = await db.owner.query<{ usename: string }>(
    "select usename from pg_stat_activity where application_name = $1 and datname = $2",
    [name, db.name],
  );
  return rows;
}

describe("ADR-0008: соединение LISTEN", () => {
  it("одно соединение роли приложения под своим именем; close() убирает его из pg_stat_activity", async () => {
    const connection = await listen("kosht-test-listen-a", inbox().handlers);
    expect(await connections("kosht-test-listen-a")).toEqual([
      { usename: inject("testDb").app.user },
    ]);
    await connection.close();
    await expect.poll(async () => connections("kosht-test-listen-a")).toEqual([]);
  });

  it("сообщение pg_notify доходит сырым текстом", async () => {
    const messages = inbox();
    await listen("kosht-test-listen-b", messages.handlers);
    await notify(createSystemDb(db.pool), ["первое", "второе"]);
    await messages.until("второе");
    expect(messages.received).toEqual(["первое", "второе"]);
  });

  it("pg_terminate_backend под владельцем — onLost один раз", async () => {
    const messages = inbox();
    let losses = 0;
    await listen("kosht-test-listen-c", {
      ...messages.handlers,
      onLost: (error) => {
        losses += 1;
        messages.handlers.onLost(error);
      },
    });
    await db.owner.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1 and datname = $2",
      ["kosht-test-listen-c", db.name],
    );
    await messages.lost;
    await expect.poll(async () => connections("kosht-test-listen-c")).toEqual([]);
    expect(losses).toBe(1);
  });

  it("не подключилось — исключение, соединения не осталось", async () => {
    const broken = { ...app.config, url: app.config.url.replace(/\/[^/]+$/, "/test_no_such_db") };
    await expect(listenConnector(broken, "kosht-test-listen-d")(inbox().handlers)).rejects.toThrow(
      "test_no_such_db",
    );
    expect(await connections("kosht-test-listen-d")).toEqual([]);
  });

  it("имя канала — kosht_realtime", () => {
    expect(REALTIME_CHANNEL).toBe("kosht_realtime");
  });
});

describe("ADR-0008: NOTIFY в транзакции ScopedDb", () => {
  it("коммит — сигнал есть; откат и ROLLBACK TO SAVEPOINT — нет (барьер: часовой дошёл первым)", async () => {
    const messages = inbox();
    await listen("kosht-test-listen-tx", messages.handlers);
    const s = createScopedDb(db.pool, testScope());

    await expect(
      s.transaction(async (tx) => {
        await notify(tx.db, ["откат"]);
        throw new Error("откат");
      }),
    ).rejects.toThrow("откат");
    await s.transaction(async (tx) => {
      await expect(
        tx.transaction(async (inner) => {
          await notify(inner.db, ["точка сохранения"]);
          throw new Error("откат точки");
        }),
      ).rejects.toThrow("откат точки");
      await notify(tx.db, ["коммит"]);
    });
    await notify(s.db, ["часовой"]);

    await messages.until("часовой");
    expect(messages.received).toEqual(["коммит", "часовой"]);
  });
});
