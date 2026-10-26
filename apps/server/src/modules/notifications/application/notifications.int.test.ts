// NOTIF-01…05 на Postgres: notify идемпотентен по ключу; новое уведомление уходит в каналы реестра, где вид не
// отключён (матрица вид × канал); лента — только доставленные на сайт, курсор и счётчик непрочитанных; «прочитано» —
// только своё; уведомления администраторов — без домохозяйства, «прочитано» у каждого админа своё.
import type { UserNotificationKind } from "@kosht/contract";
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb, type ScopedDb } from "../../../platform/db/scoped-db.ts";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { DeliveryChannel } from "../../../platform/module/define-module.ts";
import type { Realtime } from "../../../platform/realtime/realtime.ts";
import { makeAdminNotifications } from "./admin-notifications.ts";
import { makeFeed } from "./feed.ts";
import { makeNotify } from "./notify.ts";
import { webChannel } from "./web-channel.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const clock = new FakeClock("2026-10-26T09:00:00Z");

function setup() {
  const signals: { entity: string; ids: readonly string[] }[] = [];
  const realtime: Realtime = {
    changed: async (_s, signal) => {
      signals.push({ entity: signal.entity, ids: signal.ids });
    },
    progress: async () => {},
  };
  const telegram: string[] = [];
  const telegramChannel: DeliveryChannel = {
    name: "telegram",
    deliver: async (_s, ids) => {
      telegram.push(...ids);
    },
  };
  const channels = new Map([
    ["web", webChannel({ realtime })],
    ["telegram", telegramChannel],
  ]);
  const platform = { clock, log: memoryLogger().log, realtime, deliveryChannels: () => channels };
  return {
    notify: makeNotify(platform),
    feed: makeFeed(platform),
    signals,
    telegram,
  };
}

const scoped = (n: number): ScopedDb =>
  createScopedDb(db.pool, testScope({ user: n, household: n }));

describe("NOTIF-01, BUD-03: уведомление один раз на ключ", () => {
  it("повторная доставка события с тем же ключом не создаёт второго уведомления и не шлёт сигнал", async () => {
    const s = scoped(1);
    const { notify, feed, signals } = setup();
    const input = { kind: "limit", key: "limit:cafe:2026-10:80", params: { percent: 84 } } as const;
    const first = await notify(s, input);
    expect(await notify(s, input)).toBeUndefined();
    const page = await feed.list(s, { limit: 20 });
    expect(page.items).toEqual([
      {
        id: first,
        kind: "limit",
        params: { percent: 84 },
        objectRef: null,
        decisionId: null,
        undoToken: null,
        read: false,
        createdAt: "2026-10-26T09:00:00.000Z",
      },
    ]);
    expect(page.unread).toBe(1);
    expect(signals).toEqual([{ entity: "notification", ids: [first] }]);
  });

  it("уведомление с действием ссылается на решение actions и токен отмены, а не хранит вопрос", async () => {
    const s = scoped(2);
    const { notify, feed } = setup();
    await notify(s, {
      kind: "receipt-match",
      key: "match:r-1",
      objectRef: { entity: "receipt", id: "0199f0a0-0000-7000-8000-0000000000b1" },
      decisionId: "0199f0a0-0000-7000-8000-0000000000d1",
      undoToken: "0199f0a0-0000-7000-8000-0000000000c1",
    });
    expect((await feed.list(s, { limit: 20 })).items[0]).toMatchObject({
      objectRef: { entity: "receipt", id: "0199f0a0-0000-7000-8000-0000000000b1" },
      decisionId: "0199f0a0-0000-7000-8000-0000000000d1",
      undoToken: "0199f0a0-0000-7000-8000-0000000000c1",
    });
  });
});

describe("NOTIF-04: вид × канал", () => {
  it.each<[string, number, UserNotificationKind, { web: boolean; telegram: boolean }]>([
    ["всё включено — сайт и Telegram", 11, "goal", { web: true, telegram: true }],
    ["Telegram отключён — только сайт", 12, "deduction", { web: true, telegram: false }],
    [
      "сайт отключён — только Telegram, в ленте нет",
      13,
      "weekly-summary",
      { web: false, telegram: true },
    ],
    ["отключено везде — никуда", 14, "recurring-missed", { web: false, telegram: false }],
  ])("%s", async (_name, household, kind, enabled) => {
    const s = scoped(household);
    const { notify, feed, telegram } = setup();
    await feed.setPreference(s, { kind, channel: "web", enabled: enabled.web });
    await feed.setPreference(s, { kind, channel: "telegram", enabled: enabled.telegram });
    const other: UserNotificationKind = kind === "goal" ? "limit" : "goal";
    const id = await notify(s, { kind, key: "k-1" });
    const control = await notify(s, { kind: other, key: "k-1" });
    const shown = (await feed.list(s, { limit: 20 })).items.map((n) => n.id);
    expect(shown.includes(id ?? "")).toBe(enabled.web);
    expect(telegram.includes(id ?? "")).toBe(enabled.telegram);
    // Настройка одного вида не трогает другой.
    expect(shown).toContain(control);
    expect(telegram).toContain(control);
  });

  it("настройки по умолчанию — все виды на сайте и в Telegram; выключение сохраняется", async () => {
    const s = scoped(50);
    const { feed } = setup();
    const before = await feed.preferences(s);
    expect(before.items).toHaveLength(9);
    expect(before.items.every((p) => p.web && p.telegram)).toBe(true);
    await feed.setPreference(s, { kind: "limit", channel: "telegram", enabled: false });
    await feed.setPreference(s, { kind: "limit", channel: "telegram", enabled: false });
    const after = await feed.preferences(s);
    expect(after.items.find((p) => p.kind === "limit")).toEqual({
      kind: "limit",
      web: true,
      telegram: false,
    });
  });
});

describe("NOTIF-01: лента, курсор, «прочитано»", () => {
  it("страницы по курсору — новые сверху без повторов; «прочитано» уменьшает счётчик", async () => {
    const s = scoped(60);
    const { notify, feed } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      clock.advance(1_000);
      ids.push((await notify(s, { kind: "statement-imported", key: `import-${String(i)}` })) ?? "");
    }
    const first = await feed.list(s, { limit: 2 });
    expect(first.items.map((n) => n.id)).toEqual([ids[4], ids[3]]);
    const second = await feed.list(s, { cursor: first.nextCursor ?? undefined, limit: 2 });
    const third = await feed.list(s, { cursor: second.nextCursor ?? undefined, limit: 2 });
    expect([...second.items, ...third.items].map((n) => n.id)).toEqual([ids[2], ids[1], ids[0]]);
    expect(third.nextCursor).toBeNull();

    await feed.read(s, [ids[4] ?? ""]);
    expect((await feed.list(s, { limit: 1 })).unread).toBe(4);
    await feed.read(s, "all");
    expect((await feed.list(s, { limit: 1 })).unread).toBe(0);
  });

  it("чужие id в «прочитано» ничего не меняют у владельца", async () => {
    const owner = scoped(70);
    const { notify, feed } = setup();
    const id = await notify(owner, { kind: "goal", key: "g-1" });
    await feed.read(scoped(71), [id ?? ""]);
    await feed.read(scoped(71), "all");
    expect((await feed.list(owner, { limit: 5 })).items[0]?.read).toBe(false);
    expect((await feed.list(scoped(71), { limit: 5 })).items).toEqual([]);
  });
});

describe("NOTIF-03: уведомления администраторов", () => {
  it("одно на вид и ключ; «прочитано» — у каждого администратора своё", async () => {
    const admins = makeAdminNotifications({
      system: createSystemDb(db.pool),
      clock,
      log: memoryLogger().log,
    });
    const id = await admins.notifyAdmins({
      kind: "law-new-acts",
      key: "2026-10-26",
      params: { count: 3 },
    });
    expect(await admins.notifyAdmins({ kind: "law-new-acts", key: "2026-10-26" })).toBeUndefined();
    const adminA = scoped(80);
    const adminB = scoped(81);
    await admins.read(adminA, [id ?? ""]);
    const a = await admins.list(adminA, { limit: 10 });
    const b = await admins.list(adminB, { limit: 10 });
    expect(a.items).toEqual([
      expect.objectContaining({ id, kind: "law-new-acts", read: true, params: { count: 3 } }),
    ]);
    expect(b.items).toEqual([expect.objectContaining({ id, read: false })]);
    expect([a.unread, b.unread]).toEqual([0, 1]);
    const { rows } = await db.owner.query(
      "select column_name from information_schema.columns where table_name = 'admin_notifications' and column_name = 'household_id'",
    );
    expect(rows).toEqual([]);
  });
});
