// WEEK-01, WEEK-03, NFR-22 сквозь HTTP и настоящий worker (createJobs, не InlineJobs): регистрация создаёт строку настроек итогов
// недели (подписка на `identity.user-registered`), обход находит владельца одним сквозным запросом, задача `weekly.build-summary`
// выполняется worker-ом под scope владельца и отмечает неделю (операций нет — «пустая» сводка, без уведомления); настройки читаются
// и сохраняются через HTTP; чужие данные не видны. Ожидание — опрос состояния, не sleep.
import { crossTenant } from "../platform/db/cross-tenant.ts";
import type { WeeklyPreferences } from "@kosht/contract";
import { makeScope } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildJob } from "../modules/weekly/jobs/build.job.ts";
import { registerUser, startHttpStack, type HttpStack } from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db);
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

let counter = 0;
const newUser = () => {
  counter += 1;
  return registerUser(stack, db, `weekly-${String(counter)}@example.test`);
};

describe("WEEK-03: настройки сквозь HTTP", () => {
  it("гость настроек не получает; по умолчанию — включено, понедельник, 09:00; сохранённое возвращается, у соседа — умолчание", async () => {
    const guest = await stack.call("local", "/weekly/preferences");
    expect(guest.status).toBe(401);
    const user = await newUser();
    const read = async (cookie: string) =>
      (await (
        await stack.call("local", "/weekly/preferences", { cookie })
      ).json()) as WeeklyPreferences;
    expect(await read(user.cookie)).toEqual({ enabled: true, weekday: 1, time: "09:00" });
    const saved = await stack.call("local", "/weekly/preferences", {
      cookie: user.cookie,
      body: { enabled: false, weekday: 5, time: "18:30" },
    });
    expect(saved.status).toBe(200);
    expect(await read(user.cookie)).toEqual({ enabled: false, weekday: 5, time: "18:30" });
    const other = await newUser();
    expect(await read(other.cookie)).toEqual({ enabled: true, weekday: 1, time: "09:00" });
  });

  it("время не «чч:мм» и день вне 1…7 — VALIDATION", async () => {
    const user = await newUser();
    for (const body of [
      { enabled: true, weekday: 1, time: "9:00" },
      { enabled: true, weekday: 8, time: "09:00" },
    ]) {
      const response = await stack.call("local", "/weekly/preferences", {
        cookie: user.cookie,
        body,
      });
      expect(response.status).toBe(400);
    }
  });

  it("сводки ещё не было — latest пуст", async () => {
    const user = await newUser();
    const response = await stack.call("local", "/weekly/latest", { cookie: user.cookie });
    expect(await response.json()).toEqual({ summary: null });
  });
});

describe("WEEK-01, NFR-22: обход и задача на настоящем worker", () => {
  it("регистрация → строка настроек (подписка) → обход находит владельца → задача отмечает неделю «пустой» сводкой без уведомления", async () => {
    const user = await newUser();
    // Подписка на регистрацию выполняется worker-ом: строка настроек появляется без единого запроса к weekly.
    await vi.waitFor(
      async () => {
        const rows = await db.owner.query("select id from weekly_preferences where user_id = $1", [
          user.userId,
        ]);
        expect(rows.rows).toHaveLength(1);
      },
      { timeout: 15_000, interval: 200 },
    );
    const weekly = stack.api.modules.find((m) => m.id === "weekly");
    const sweep = weekly?.sweeps.find((item) => item.name === "weekly.build-summary-sweep");
    const job = (weekly?.jobs ?? []).find((item) => item.name === "weekly.build-summary");
    expect(job).toBeDefined();
    expect(sweep).toBeDefined();
    const owners = await crossTenant(db.pool, "weekly.build-summary-sweep", sweep!.find);
    const mine = owners.find((row) => row.userId === user.userId);
    expect(mine).toMatchObject({ householdId: user.householdId });

    const scoped = stack.api.platform.scoped(makeScope(user));
    await scoped.transaction((tx) =>
      stack.api.platform.jobs.enqueue(tx, job as ReturnType<typeof buildJob>, {}),
    );
    await vi.waitFor(
      async () => {
        const rows = await db.owner.query<{ status: string }>(
          "select status from weekly_summaries where user_id = $1",
          [user.userId],
        );
        expect(rows.rows.map((row) => row.status)).toEqual(["empty"]);
      },
      { timeout: 20_000, interval: 200 },
    );
    const notices = await db.owner.query(
      "select 1 from notifications where user_id = $1 and kind = 'weekly-summary'",
      [user.userId],
    );
    expect(notices.rows).toHaveLength(0);
  }, 40_000);

  it("WEEK-03: пользователь без строки настроек (зарегистрирован до T-050) всё равно в обходе — отсутствующая строка считается умолчанием", async () => {
    const user = await newUser();
    await vi.waitFor(
      async () => {
        const rows = await db.owner.query("select id from weekly_preferences where user_id = $1", [
          user.userId,
        ]);
        expect(rows.rows).toHaveLength(1);
      },
      { timeout: 15_000, interval: 200 },
    );
    await db.owner.query("delete from weekly_preferences where user_id = $1", [user.userId]);
    const weekly = stack.api.modules.find((m) => m.id === "weekly");
    const sweep = weekly?.sweeps.find((item) => item.name === "weekly.build-summary-sweep");
    const owners = await crossTenant(db.pool, "weekly.build-summary-sweep", sweep!.find);
    expect(owners.map((row) => row.userId)).toContain(user.userId);

    const job = (weekly?.jobs ?? []).find((item) => item.name === "weekly.build-summary");
    const scoped = stack.api.platform.scoped(makeScope(user));
    await scoped.transaction((tx) =>
      stack.api.platform.jobs.enqueue(tx, job as ReturnType<typeof buildJob>, {}),
    );
    await vi.waitFor(
      async () => {
        const rows = await db.owner.query<{ status: string }>(
          "select status from weekly_summaries where user_id = $1",
          [user.userId],
        );
        expect(rows.rows).toHaveLength(1);
      },
      { timeout: 20_000, interval: 200 },
    );
  }, 40_000);
});
