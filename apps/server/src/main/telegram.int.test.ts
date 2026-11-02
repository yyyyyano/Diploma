// TG-02, PRIV-08, PRIV-06, SEC-04 сквозь настоящий корень композиции: «Подключить Telegram» на сайте по HTTP → «Старт» через
// настоящий grammY (вызовы Bot API пишет трансформер, сети нет — NFR-11) → «подключён»; отключение отзывает согласие;
// удаление аккаунта разрывает привязку; чужие чек и решение в кнопке — «Не нашёл» без изменений.
import { CONSENT_VERSIONS, createTelegramT } from "@kosht/i18n";
import { makeScope } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memoryLogger } from "../platform/logging/__fixtures__/memory-logger.ts";
import type { ActionsFacade } from "../modules/actions/index.ts";
import type { NotificationsFacade } from "../modules/notifications/index.ts";
import { encodeCallback } from "../modules/telegram/domain/callback-data.ts";
import { createBot } from "../modules/telegram/infrastructure/bot/bot-runtime.ts";
import type { TelegramFacade } from "../modules/telegram/index.ts";
import { TELEGRAM_TOKEN } from "../modules/telegram/settings.ts";
import {
  registerUser,
  startHttpStack,
  STACK_PASSWORD,
  type HttpStack,
} from "./__fixtures__/http-stack.ts";

const t = createTelegramT();
const TOKEN = "222222:stack-token";
const BOT = {
  id: 222222,
  is_bot: true,
  first_name: "Кошт",
  username: "kosht_stack_bot",
};

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db, { worker: false });
  await stack.api.platform.secrets.set(TELEGRAM_TOKEN, TOKEN);
  await db.owner.query(
    "insert into telegram_bot (id, username, updated_at) values (1, $1, now())",
    [BOT.username],
  );
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

function telegram(): TelegramFacade {
  const module = stack.api.modules.find((m) => m.id === "telegram");
  if (module === undefined) throw new Error("нет модуля telegram");
  return module.facade as TelegramFacade;
}

function actions(): ActionsFacade {
  const module = stack.api.modules.find((m) => m.id === "actions");
  if (module === undefined) throw new Error("нет модуля actions");
  return module.facade as ActionsFacade;
}

/** Бот с настоящим обработчиком модуля и записывающим трансформером вместо сети. */
function bot() {
  const sent: string[] = [];
  const { bot: grammy } = createBot(
    TOKEN,
    { handler: telegram().handler, log: memoryLogger().log },
    {
      botInfo: BOT as never,
    },
  );
  let messageId = 0;
  grammy.api.config.use(async (_prev, method, payload) => {
    if (method === "sendMessage") sent.push(String((payload as { text: string }).text));
    messageId += 1;
    return {
      ok: true,
      result:
        method === "sendMessage"
          ? { message_id: messageId, date: 1, chat: { id: 1, type: "private" } }
          : true,
    } as never;
  });
  let updateId = 0;
  const feed = async (update: Record<string, unknown>) => {
    updateId += 1;
    await grammy.handleUpdate({ update_id: updateId, ...update } as never);
    await telegram().handler.drain();
  };
  return {
    sent,
    text: (chatId: number, text: string) =>
      feed({
        message: {
          message_id: 1,
          date: 1_800_000_000,
          chat: { id: chatId, type: "private" },
          from: { id: chatId, is_bot: false, first_name: "Ирина", username: "irina_k" },
          text,
        },
      }),
    press: (chatId: number, data: string) =>
      feed({
        callback_query: {
          id: "cb",
          chat_instance: "x",
          from: { id: chatId, is_bot: false, first_name: "Ирина" },
          data,
          message: {
            message_id: 5,
            date: 1,
            chat: { id: chatId, type: "private" },
            text: "Карточка",
          },
        },
      }),
  };
}

async function beginLink(
  cookie: string,
  version: string = CONSENT_VERSIONS.telegram,
): Promise<Response> {
  return stack.call("local", "/telegram/link", { cookie, body: { version } });
}

async function statusOf(cookie: string) {
  return (await stack.call("local", "/telegram", { cookie })).json();
}

async function consentHistory(cookie: string) {
  const state = (await (await stack.call("local", "/privacy", { cookie })).json()) as {
    history: { kind: string; granted: boolean }[];
  };
  return state.history
    .filter((row) => row.kind === "telegram")
    .map((row) => ({ kind: row.kind, granted: row.granted }));
}

describe("TG-02, PRIV-08: подключение с сайта", () => {
  it("«Подключить» → ссылка на бота со скрытым кодом → «Старт» → «подключён»; согласие записано", async () => {
    const user = await registerUser(stack, db, "tg-link@example.test");
    expect(await statusOf(user.cookie)).toMatchObject({
      configured: true,
      botName: BOT.username,
      linked: null,
      pending: null,
    });

    const response = await beginLink(user.cookie);
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    expect(url).toMatch(new RegExp(`^https://t\\.me/${BOT.username}\\?start=[A-Za-z0-9_-]{43}$`));
    expect(await statusOf(user.cookie)).toMatchObject({
      pending: { expiresAt: expect.any(String) },
    });
    expect(await consentHistory(user.cookie)).toEqual([{ kind: "telegram", granted: true }]);

    const chat = bot();
    await chat.text(7001, `/start ${url.split("start=")[1]}`);
    expect(chat.sent).toEqual([t("bot.start.linked")]);
    expect(await statusOf(user.cookie)).toMatchObject({
      linked: { username: "irina_k" },
      pending: null,
    });
  });

  it("устаревшая версия текста согласия — CONFLICT, кода и согласия нет", async () => {
    const user = await registerUser(stack, db, "tg-stale@example.test");
    const response = await beginLink(user.cookie, "2020-01-01");
    expect(response.status).toBe(409);
    expect(await consentHistory(user.cookie)).toEqual([]);
    expect(await statusOf(user.cookie)).toMatchObject({ pending: null });
  });

  it("токена нет — «бот не настроен»: ссылка не выдаётся", async () => {
    const user = await registerUser(stack, db, "tg-noconf@example.test");
    await stack.api.platform.secrets.clear(TELEGRAM_TOKEN);
    try {
      expect(await statusOf(user.cookie)).toMatchObject({ configured: false });
      expect((await beginLink(user.cookie)).status).toBe(503);
    } finally {
      await stack.api.platform.secrets.set(TELEGRAM_TOKEN, TOKEN);
    }
  });

  it("отключение на сайте снимает привязку и отзывает согласие", async () => {
    const user = await registerUser(stack, db, "tg-unlink@example.test");
    const { url } = (await (await beginLink(user.cookie)).json()) as { url: string };
    await bot().text(7002, `/start ${url.split("start=")[1]}`);
    // Без токена бот в чат не пишет (в тесте сети нет): отключение само — на сервере.
    await stack.api.platform.secrets.clear(TELEGRAM_TOKEN);
    try {
      const response = await stack.call("local", "/telegram/unlink", {
        cookie: user.cookie,
        post: true,
      });
      expect(response.status).toBe(200);
    } finally {
      await stack.api.platform.secrets.set(TELEGRAM_TOKEN, TOKEN);
    }
    expect(await statusOf(user.cookie)).toMatchObject({ linked: null });
    expect((await consentHistory(user.cookie))[0]).toEqual({ kind: "telegram", granted: false });
  });
});

describe("TG-06, NOTIF-04: канал доставки уведомлений", () => {
  const notifications = () => {
    const module = stack.api.modules.find((m) => m.id === "notifications");
    if (module === undefined) throw new Error("нет модуля notifications");
    return module.facade as NotificationsFacade;
  };
  const queued = async (userId: string) =>
    (
      await db.owner.query<{ n: string }>(
        "select count(*)::text as n from pgboss.job where name = 'telegram.deliver-notification' and data -> 'scope' ->> 'userId' = $1",
        [userId],
      )
    ).rows[0]?.n;

  it("канал `telegram` есть в реестре доставки; уведомление ставит задачу воркеру в транзакции источника", async () => {
    expect([...stack.api.platform.deliveryChannels().keys()].toSorted()).toEqual([
      "telegram",
      "web",
    ]);
    const user = await registerUser(stack, db, "tg-notify@example.test");
    const s = stack.api.platform.scoped(makeScope(user));
    await notifications().notify(s, {
      kind: "limit",
      key: "tg:limit:1",
      params: { category: "system:cafes", threshold: 80 },
    });
    expect(await queued(user.userId)).toBe("1");
    // Повтор того же ключа — не второе уведомление и не вторая задача.
    await notifications().notify(s, {
      kind: "limit",
      key: "tg:limit:1",
      params: { category: "system:cafes", threshold: 80 },
    });
    expect(await queued(user.userId)).toBe("1");
  });

  it("вид отключён в Telegram (NOTIF-04) — задачи нет, на сайте уведомление есть", async () => {
    const user = await registerUser(stack, db, "tg-notify-off@example.test");
    const off = await stack.call("local", "/notifications/preferences", {
      cookie: user.cookie,
      body: { kind: "limit", channel: "telegram", enabled: false },
    });
    expect(off.status).toBe(200);
    const s = stack.api.platform.scoped(makeScope(user));
    await notifications().notify(s, { kind: "limit", key: "tg:limit:off", params: {} });
    expect(await queued(user.userId)).toBe("0");
    const feed = (await (
      await stack.call("local", "/notifications", { cookie: user.cookie })
    ).json()) as {
      items: unknown[];
    };
    expect(feed.items).toHaveLength(1);
  });
});

describe("PRIV-06: удаление аккаунта", () => {
  it("привязка Telegram разрывается: строк в системных таблицах бота нет", async () => {
    const user = await registerUser(stack, db, "tg-delete@example.test");
    const { url } = (await (await beginLink(user.cookie)).json()) as { url: string };
    await bot().text(7003, `/start ${url.split("start=")[1]}`);
    const response = await stack.call("local", "/identity/delete-account", {
      cookie: user.cookie,
      body: { password: STACK_PASSWORD },
    });
    expect(response.status).toBe(200);
    for (const table of ["telegram_links", "telegram_link_codes", "telegram_receipt_cards"]) {
      const { rows } = await db.owner.query(`select 1 from ${table} where household_id = $1`, [
        user.householdId,
      ]);
      expect(rows).toEqual([]);
    }
  });
});

describe("SEC-04: чужие сущности в кнопках", () => {
  it("чек и решение другого домохозяйства — «Не нашёл», ничего не изменено", async () => {
    const owner = await registerUser(stack, db, "tg-owner@example.test");
    const stranger = await registerUser(stack, db, "tg-stranger@example.test");
    const { url } = (await (await beginLink(stranger.cookie)).json()) as { url: string };
    const chat = bot();
    await chat.text(7004, `/start ${url.split("start=")[1]}`);

    const receipt = await db.owner.query<{ id: string }>(
      `insert into receipts (household_id, user_id, file_id, status)
       values ($1, $2, uuidv7(), 'ok') returning id`,
      [owner.householdId, owner.userId],
    );
    const receiptId = receipt.rows[0]?.id ?? "";
    const handler = [...stack.api.platform.actionHandlers().confirm.keys()][0] ?? "";
    const decisionId = await actions().propose(stack.api.platform.scoped(makeScope(owner)), {
      handler,
      payload: {},
      summary: { key: "decisions:test", params: {} },
    });

    await chat.press(7004, encodeCallback({ action: "receipt-cancel", id: receiptId }));
    await chat.press(7004, encodeCallback({ action: "receipt-confirm", id: receiptId }));
    await chat.press(7004, encodeCallback({ action: "decision-yes", id: decisionId }));

    expect(chat.sent.filter((text) => text === t("bot.notFound"))).toHaveLength(3);
    const receipts = await db.owner.query("select 1 from receipts where id = $1", [receiptId]);
    expect(receipts.rows).toHaveLength(1);
    const decisions = await db.owner.query<{ status: string }>(
      "select status from pending_decisions where id = $1",
      [decisionId],
    );
    expect(decisions.rows[0]?.status).toBe("pending");
  });
});
