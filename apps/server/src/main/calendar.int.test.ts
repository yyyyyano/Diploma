// CAL-01, CAL-06, CAL-07, P5, AGT-07, DASH-02 сквозь HTTP и корень композиции (api + worker): своё событие — создать, увидеть в месяце,
// сдвинуть день, удалить решением «Да/Нет» и вернуть «Отменить»; напоминания лежат в таблице по одному на «за сколько дней»;
// событие видно на главной; чужой календарь не виден.
import type { CalendarEntry } from "@kosht/contract";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser, startHttpStack, type HttpStack } from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db, { env: { LLM_MODELS_DOWNLOAD: "0" } });
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

/** День через `days` дней от сегодняшнего (по UTC: стенд на настоящих часах, запас в сутки не мешает). */
const inDays = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

type User = Awaited<ReturnType<typeof registerUser>>;
let counter = 0;
const newUser = (): Promise<User> => {
  counter += 1;
  return registerUser(stack, db, `calendar-${String(counter)}@example.test`);
};

async function call<T = unknown>(user: User, path: string, body?: unknown): Promise<T> {
  const response = await stack.call("local", path, {
    cookie: user.cookie,
    ...(body === undefined ? {} : { body }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

const monthOf = (day: string) => day.slice(0, 7);
const entriesIn = async (user: User, day: string) =>
  (await call<{ entries: CalendarEntry[] }>(user, `/calendar/month?month=${monthOf(day)}`)).entries;

describe("CAL-06, CAL-07: своё событие сквозь HTTP", () => {
  it("создать → видно в месяце с суммой и traceId → напоминания в таблице (за 7 и 1 день)", async () => {
    const user = await newUser();
    const on = inDays(20);
    const { event, undoToken } = await call<{ event: CalendarEntry; undoToken: string }>(
      user,
      "/calendar/event",
      { title: "Оплатить садик", on, amount: { minor: 12_000, currency: "BYN" } },
    );
    expect(event).toMatchObject({
      type: "own",
      title: "Оплатить садик",
      on,
      amount: { minor: 12_000, currency: "BYN" },
      remindDays: [7, 1],
      canDelete: true,
    });
    expect(undoToken).toEqual(expect.any(String));
    expect((await entriesIn(user, on)).map((e) => e.id)).toContain(event.id);
    const rows = await db.owner.query<{ offset_days: number }>(
      "select offset_days from calendar_reminders where event_id = $1 order by offset_days desc",
      [event.id],
    );
    expect(rows.rows.map((r) => r.offset_days)).toEqual([7, 1]);
  }, 30_000);

  it("прошедший день — VALIDATION; удаление — только решение: «Да» удаляет, «Отменить» возвращает", async () => {
    const user = await newUser();
    const past = await stack.call("local", "/calendar/event", {
      cookie: user.cookie,
      body: { title: "Давно", on: inDays(-3) },
    });
    expect(past.status).toBe(400);
    const on = inDays(25);
    const { event } = await call<{ event: CalendarEntry }>(user, "/calendar/event", {
      title: "Оплатить кружок",
      on,
    });
    const { decisionId } = await call<{ decisionId: string }>(user, "/calendar/event/delete", {
      id: event.id,
    });
    expect((await entriesIn(user, on)).map((e) => e.id)).toContain(event.id);
    const answered = await call<{ status: string; undoToken: string | null }>(
      user,
      "/actions/answer",
      { id: decisionId, answer: "yes" },
    );
    expect(answered.status).toBe("yes");
    expect((await entriesIn(user, on)).map((e) => e.id)).not.toContain(event.id);
    await call(user, "/actions/undo", { token: answered.undoToken });
    expect((await entriesIn(user, on)).map((e) => e.id)).toContain(event.id);
  }, 30_000);

  it("сдвинуть день: напоминания пересчитаны; чужое событие — 404, как несуществующее", async () => {
    const user = await newUser();
    const stranger = await newUser();
    const on = inDays(30);
    const { event } = await call<{ event: CalendarEntry }>(user, "/calendar/event", {
      title: "Налог",
      on,
      type: "tax",
    });
    const moved = await call<{ event: CalendarEntry }>(user, "/calendar/event/update", {
      id: event.id,
      on: inDays(40),
      remindDays: [30, 0],
    });
    expect(moved.event).toMatchObject({ on: inDays(40), remindDays: [30, 0] });
    const foreign = await stack.call("local", "/calendar/event/update", {
      cookie: stranger.cookie,
      body: { id: event.id, remindDays: [1] },
    });
    expect(foreign.status).toBe(404);
    expect(await entriesIn(stranger, on)).toEqual([]);
  }, 30_000);

  it("DASH-02: событие в ближайшие 30 дней — на главной", async () => {
    const user = await newUser();
    const { event } = await call<{ event: CalendarEntry }>(user, "/calendar/event", {
      title: "Оплатить кружок",
      on: inDays(10),
    });
    const overview = await call<{ events: CalendarEntry[] }>(user, "/dashboard");
    expect(overview.events.map((e) => e.id)).toEqual([event.id]);
  }, 30_000);

  it("список «Ближайшие»: событие в группе, итоги платежей — null, пока сумм нет", async () => {
    const user = await newUser();
    await call(user, "/calendar/event", { title: "Без суммы", on: inDays(5) });
    const upcoming = await call<{ groups: { entries: CalendarEntry[]; totals: unknown }[] }>(
      user,
      "/calendar/upcoming",
    );
    expect(upcoming.groups.flatMap((g) => g.entries.map((e) => e.title))).toContain("Без суммы");
    for (const group of upcoming.groups) {
      expect(group.totals).toMatchObject({ payments: null });
    }
  }, 30_000);
});
