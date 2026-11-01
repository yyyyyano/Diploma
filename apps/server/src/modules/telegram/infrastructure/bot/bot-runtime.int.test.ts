// TG-10: опрос под замком, смена токена и остановка. Настоящий grammY и Postgres; Bot API — трансформер (getMe задан `botInfo`,
// getUpdates отвечает пустым списком с паузой), сети нет.
import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../../platform/logging/__fixtures__/memory-logger.ts";
import { acquirePollLock } from "../db/poll-lock.ts";
import { createBotRuntime } from "./bot-runtime.ts";

const BOT = {
  id: 9,
  is_bot: true,
  first_name: "Кошт",
  username: "kosht_poll_bot",
} as UserFromGetMe;

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

function runtime(token: () => string | undefined) {
  const system = createSystemDb(db.pool);
  const log = memoryLogger();
  const polled: string[] = [];
  const instance = createBotRuntime({
    system,
    secrets: { reveal: async () => token() },
    settings: { get: async () => 1 },
    log: log.log,
    handler: { handle: async () => undefined },
    now: () => new Date(),
    makeBot: (value) => {
      const bot = new Bot(value, { botInfo: BOT });
      bot.api.config.use(async (_prev, method) => {
        if (method === "getUpdates") {
          polled.push(value);
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { ok: true, result: [] } as never;
        }
        return { ok: true, result: true } as never;
      });
      return bot;
    },
  });
  return { system, log, polled, ...instance };
}

const until = async (condition: () => boolean | Promise<boolean>) => {
  for (let step = 0; step < 100; step += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("не дождались");
};

describe("TG-10: опрос бота", () => {
  it("опрос стартует с токеном, пишет имя бота и telegram.started; остановка быстрая, замок свободен", async () => {
    const r = runtime(() => "1:token-a");
    r.start();
    await until(() => r.polled.length > 0);
    expect(
      r.log
        .lines()
        .some((line) => line["msg"] === "telegram.started" && line["bot"] === BOT.username),
    ).toBe(true);
    const { rows } = await db.owner.query<{ username: string }>(
      "select username from telegram_bot",
    );
    expect(rows[0]?.username).toBe(BOT.username);

    const started = performance.now();
    await r.stop();
    expect(performance.now() - started).toBeLessThan(2_000);
    const lock = await acquirePollLock(r.system, () => undefined, 50);
    expect(lock).toBeDefined();
    await lock?.release();
  });

  it("второй экземпляр, пока замок занят, не опрашивает; освободился — подхватывает", async () => {
    const system = createSystemDb(db.pool);
    const holder = await acquirePollLock(system, () => undefined, 50);
    const r = runtime(() => "1:token-b");
    r.start();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(r.polled).toEqual([]);
    await holder?.release();
    await until(() => r.polled.length > 0);
    expect(r.polled).toEqual(["1:token-b", ...r.polled.slice(1)]);
    await r.stop();
  });

  it("смена токена перезапускает только бота внутри процесса: опрос продолжается с новым токеном", async () => {
    let token = "1:token-c";
    const r = runtime(() => token);
    r.start();
    await until(() => r.polled.includes("1:token-c"));
    token = "2:token-d";
    await until(() => r.polled.includes("2:token-d"));
    await r.stop();
    expect(r.log.lines().filter((line) => line["msg"] === "telegram.started")).toHaveLength(2);
  });

  it("токена нет — опроса нет и имени бота нет: сайт покажет «не настроен»", async () => {
    const r = runtime(() => undefined);
    r.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(r.polled).toEqual([]);
    const { rows } = await db.owner.query("select 1 from telegram_bot");
    expect(rows).toEqual([]);
    await r.stop();
  });
});
