// TG-01…05, TG-10, TG-11, VOICE-01, AUTH-11, SEC-05 через настоящий grammY: обновления — `bot.handleUpdate`, вызовы Bot API
// пишет трансформер (сети нет, NFR-11), БД — настоящий Postgres (привязки, коды), соседи — управляемые подмены.
import { LocalDate, HouseholdId, makeScope, UserId } from "@kosht/kernel";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { CONSENT_VERSIONS, createTelegramT, formatMoney } from "@kosht/i18n";
import type { UIMessageChunk } from "ai";
import type { UserFromGetMe } from "grammy/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../../platform/db/scoped-db.ts";
import { createSystemDb } from "../../../../platform/db/system-db.ts";
import { AppError } from "../../../../platform/errors/app-error.ts";
import { memoryLogger } from "../../../../platform/logging/__fixtures__/memory-logger.ts";
import { encodeCallback } from "../../domain/callback-data.ts";
import type { TelegramDeps } from "../../application/deps.ts";
import { makeBotHandler } from "../../application/handler.ts";
import { makeLinkOps } from "../../application/link.ts";
import { FileTooLargeError } from "../../application/ports.ts";
import { saveBotName } from "../db/telegram.repo.ts";
import { createBot } from "./bot-runtime.ts";

const t = createTelegramT();
const TOKEN = "111111:test-token";
const BOT = {
  id: 111111,
  is_bot: true,
  first_name: "Кошт",
  username: "kosht_test_bot",
} as UserFromGetMe;

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await saveBotName(createSystemDb(db.pool), BOT.username, new Date());
});
afterAll(async () => {
  await db.drop();
});

interface ApiCall {
  readonly method: string;
  readonly payload: Record<string, unknown>;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER_A = { userId: uuid(1), householdId: uuid(101) };
const OWNER_B = { userId: uuid(2), householdId: uuid(102) };

/** Стенд: настоящие привязки и коды в БД, настоящий grammY; соседи и Bot API — подмены с журналом. */
function harness() {
  const system = createSystemDb(db.pool);
  const calls: ApiCall[] = [];
  const failing = new Set<string>();
  const log = memoryLogger();
  const spy = {
    asked: [] as { text: string; sentAt: Date; idleMs: number }[],
    newConversations: 0,
    transcribed: 0,
    accepted: [] as { kind: string; name: string; bytes: number }[],
    receipts: [] as string[],
    answers: [] as { id: string; reply: string; channel: string }[],
    cancelledReceipts: [] as string[],
  };
  const state = {
    member: new Map<string, "active" | "blocked" | "absent">(),
    consent: new Set<string>(),
    cloud: true,
    answerText: "Вы потратили **412,30 BYN** на кафе.",
    transcript: "Потратил пятнадцать рублей на кофе",
    receiptStatus: "ok" as "ok" | "processing" | "failed",
    ownReceipts: new Set<string>(),
    statementStatus: "ready" as "ready" | "parsing" | "failed",
    fileSize: 1000,
  };
  const stream = (text: string) =>
    new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({ type: "start" });
        for (const part of text.match(/.{1,7}/gsu) ?? []) {
          controller.enqueue({ type: "text-delta", id: "t", delta: part });
        }
        controller.close();
      },
    });
  const deps: TelegramDeps = {
    system,
    platform: {
      clock: new FakeClock("2026-11-01T12:00:00Z"),
      log: log.log,
      settings: { get: async (def: { default: unknown }) => def.default },
      secrets: { status: async () => "set", reveal: async () => TOKEN },
      consent: { cloudAllowed: async () => state.cloud },
      events: { publish: async () => undefined },
    } as never,
    neighbours: {
      files: {
        accept: async (
          _s: unknown,
          kind: string,
          uploads: readonly { name: string; content: Uint8Array }[],
        ) => {
          for (const upload of uploads) {
            spy.accepted.push({ kind, name: upload.name, bytes: upload.content.byteLength });
          }
          return [{ id: uuid(900), name: "f", mime: "x", size: 1 }];
        },
      },
      chat: {
        ask: async (_s: unknown, input: { text: string; sentAt: Date; idleMs: number }) => {
          spy.asked.push({ text: input.text, sentAt: input.sentAt, idleMs: input.idleMs });
          return stream(state.answerText);
        },
        startNew: async () => {
          spy.newConversations += 1;
        },
      },
      identity: {
        memberState: async (owner: { userId: string }) =>
          state.member.get(owner.userId) ?? "active",
      },
      privacy: {
        setTelegramConsent: async (s: { scope: { userId: string } }, d: { granted: boolean }) => {
          if (d.granted) state.consent.add(s.scope.userId);
          else state.consent.delete(s.scope.userId);
        },
        telegramConsentGiven: async (s: { scope: { userId: string } }) =>
          state.consent.has(s.scope.userId),
      },
      actions: {
        answer: async (_s: unknown, id: string, reply: string, channel: string) => {
          spy.answers.push({ id, reply, channel });
          return { status: reply, undoToken: null };
        },
      },
      receipts: {
        start: async () => {
          spy.receipts.push("start");
          return { id: uuid(500) };
        },
        card: async (_s: unknown, id: string) => {
          if (!state.ownReceipts.has(id)) throw new AppError("NOT_FOUND");
          return {
            receipt: {
              status: state.receiptStatus,
              storeName: "Евроопт",
              total: { minor: 4730, currency: "BYN" },
              disputedLines: [],
              errorCode: null,
              duplicateOf: null,
            },
            items: Array.from({ length: 10 }, () => ({})),
          };
        },
        confirm: async (_s: unknown, id: string) => {
          if (!state.ownReceipts.has(id)) throw new AppError("NOT_FOUND");
        },
        cancel: async (_s: unknown, id: string) => {
          if (!state.ownReceipts.has(id)) throw new AppError("NOT_FOUND");
          spy.cancelledReceipts.push(id);
        },
      },
      statements: {
        start: async () => ({ id: uuid(600) }),
        summary: async () => ({
          status: state.statementStatus,
          found: 23,
          duplicates: 6,
          newCount: 17,
        }),
        confirm: async () => ({
          imported: 17,
          duplicates: 6,
          undoToken: uuid(7),
          decisionId: null,
        }),
        cancel: async () => ({ id: uuid(600) }),
      },
      voice: {
        transcribe: async () => {
          spy.transcribed += 1;
          return state.transcript;
        },
      },
    } as never,
    scopedFor: (owner) =>
      createScopedDb(
        db.pool,
        makeScope({
          userId: UserId.parse(owner.userId),
          householdId: HouseholdId.parse(owner.householdId),
        }),
      ),
    t,
    siteOrigin: async () => "http://127.0.0.1:8140",
    sender: async () => undefined,
    sleep: async () => undefined,
  };
  const links = makeLinkOps(deps);
  const handler = makeBotHandler(deps, links);
  const { bot } = createBot(
    TOKEN,
    {
      handler,
      log: log.log,
      fetchBytes: async (_url, maxBytes) => {
        if (state.fileSize > maxBytes) throw new FileTooLargeError();
        return new Uint8Array(state.fileSize);
      },
    },
    { botInfo: BOT },
  );
  let messageId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (failing.has(method))
      return { ok: false, error_code: 400, description: "Bad Request: test" };
    switch (method) {
      case "sendMessage":
        messageId += 1;
        return {
          ok: true,
          result: { message_id: messageId, date: 1, chat: { id: 1, type: "private" }, text: "x" },
        } as never;
      case "getFile":
        return {
          ok: true,
          result: { file_id: "f", file_path: "docs/file", file_size: state.fileSize },
        } as never;
      default:
        return { ok: true, result: true } as never;
    }
  });
  let updateId = 0;
  const base = (chatId: number, type = "private", fromId = chatId) => ({
    message_id: (messageId += 1),
    date: Math.floor(new Date("2026-11-01T22:30:00Z").getTime() / 1000),
    chat: { id: chatId, type },
    from: { id: fromId, is_bot: false, first_name: "Ирина", username: "irina_k" },
  });
  const send = async (message: Record<string, unknown>) => {
    updateId += 1;
    await bot.handleUpdate({ update_id: updateId, message } as never);
    await handler.drain();
  };
  return {
    system,
    calls,
    failing,
    spy,
    state,
    links,
    log,
    handler,
    text: (chatId: number, text: string) => send({ ...base(chatId), text }),
    raw: (chatId: number, extra: Record<string, unknown>, type = "private", fromId = chatId) =>
      send({ ...base(chatId, type, fromId), ...extra }),
    press: async (chatId: number, data: string, messageText = "Карточка") => {
      updateId += 1;
      await bot.handleUpdate({
        update_id: updateId,
        callback_query: {
          id: "cb1",
          chat_instance: "x",
          from: { id: chatId, is_bot: false, first_name: "Ирина" },
          data,
          message: {
            message_id: 7,
            date: 1,
            chat: { id: chatId, type: "private" },
            text: messageText,
          },
        },
      } as never);
      await handler.drain();
    },
    sent: () =>
      calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload["text"])),
    methods: () => calls.map((c) => c.method),
  };
}

type Harness = ReturnType<typeof harness>;

/** Кнопки отправленного сообщения (ряды подписей). */
function keyboardOf(call: ApiCall | undefined): { text: string }[][] {
  const markup = call?.payload["reply_markup"] as
    | { inline_keyboard: { text: string }[][] }
    | undefined;
  return markup?.inline_keyboard ?? [];
}

/** Привязать чат владельцу через настоящие код и «Старт». */
async function link(h: Harness, owner: { userId: string; householdId: string }, chatId: number) {
  const s = createScopedDb(
    db.pool,
    makeScope({
      userId: UserId.parse(owner.userId),
      householdId: HouseholdId.parse(owner.householdId),
    }),
  );
  const { url } = await h.links.beginLink(s, { version: CONSENT_VERSIONS.telegram });
  await h.text(chatId, `/start ${url.split("start=")[1]}`);
  return url.split("start=")[1] as string;
}

let chat = 1_000;
const nextChat = () => (chat += 1);
beforeEach(async () => {
  await db.owner.query("delete from telegram_links");
  await db.owner.query("delete from telegram_link_codes");
  await db.owner.query("delete from telegram_receipt_cards");
});

describe("TG-02: привязка одной кнопкой", () => {
  it("«Подключить» → ссылка со скрытым кодом → «Старт» → «Готово, аккаунт подключён»; в базе — хэш, а не код", async () => {
    const h = harness();
    const chatId = nextChat();
    const code = await link(h, OWNER_A, chatId);
    expect(h.sent().at(-1)).toBe(t("bot.start.linked"));
    const { rows } = await db.owner.query<{ code_hash: string }>(
      "select code_hash from telegram_link_codes",
    );
    expect(rows[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(code);
    const status = await h.links.status(
      createScopedDb(
        db.pool,
        makeScope({
          userId: UserId.parse(OWNER_A.userId),
          householdId: HouseholdId.parse(OWNER_A.householdId),
        }),
      ),
    );
    expect(status).toMatchObject({
      configured: true,
      botName: "kosht_test_bot",
      linked: { username: "irina_k" },
    });
  });

  it("повтор того же кода — «уже использована», просроченный — «просрочена», выдуманный — «не подошла»", async () => {
    const h = harness();
    const code = await link(h, OWNER_A, nextChat());
    await h.text(nextChat(), `/start ${code}`);
    expect(h.sent().at(-1)).toBe(t("bot.start.used"));

    const s = createScopedDb(
      db.pool,
      makeScope({
        userId: UserId.parse(OWNER_B.userId),
        householdId: HouseholdId.parse(OWNER_B.householdId),
      }),
    );
    const { url } = await h.links.beginLink(s, { version: CONSENT_VERSIONS.telegram });
    await db.owner.query(
      "update telegram_link_codes set expires_at = '2000-01-01' where user_id = $1",
      [OWNER_B.userId],
    );
    await h.text(nextChat(), `/start ${url.split("start=")[1]}`);
    expect(h.sent().at(-1)).toBe(t("bot.start.expired", { minutes: 10 }));

    await h.text(nextChat(), `/start ${"x".repeat(43)}`);
    expect(h.sent().at(-1)).toBe(t("bot.start.invalid"));
    await h.text(nextChat(), "/start коротко");
    expect(h.sent().at(-1)).toBe(t("bot.start.invalid"));
  });

  it("один чат — один аккаунт: чужой «Старт» из уже привязанного чата отказан, привязка прежняя", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    await link(h, OWNER_B, chatId);
    expect(h.sent().at(-1)).toBe(t("bot.start.chatTaken"));
    const { rows } = await db.owner.query<{ user_id: string }>(
      "select user_id from telegram_links",
    );
    expect(rows).toEqual([{ user_id: OWNER_A.userId }]);
  });

  it("согласие отозвали до «Старт» — привязки нет", async () => {
    const h = harness();
    const chatId = nextChat();
    const s = createScopedDb(
      db.pool,
      makeScope({
        userId: UserId.parse(OWNER_A.userId),
        householdId: HouseholdId.parse(OWNER_A.householdId),
      }),
    );
    const { url } = await h.links.beginLink(s, { version: CONSENT_VERSIONS.telegram });
    await h.links.cancelLink(s);
    await h.text(chatId, `/start ${url.split("start=")[1]}`);
    expect(h.sent().at(-1)).toBe(t("bot.start.invalid"));
    expect(h.state.consent.has(OWNER_A.userId)).toBe(false);
  });

  it("/unlink снимает привязку и отзывает согласие; дальше чат — «Подключите аккаунт»", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    expect(h.state.consent.has(OWNER_A.userId)).toBe(true);
    await h.text(chatId, "/unlink");
    expect(h.sent().at(-1)).toBe(t("bot.unlinked"));
    expect(h.state.consent.has(OWNER_A.userId)).toBe(false);
    await h.text(chatId, "Привет");
    expect(h.sent().at(-1)).toBe(t("bot.notLinked"));
  });
});

describe("TG-01, TG-11, AUTH-11: кому бот отвечает", () => {
  it("непривязанному — «Подключите аккаунт», ни модель, ни данные не трогаются", async () => {
    const h = harness();
    await h.text(nextChat(), "Сколько я потратил?");
    expect(h.sent()).toEqual([t("bot.notLinked")]);
    expect(h.spy.asked).toEqual([]);
  });

  it("группа — одна фраза и выход из чата, привязка группе не помогает", async () => {
    const h = harness();
    await h.raw(-5000, { text: "Привет" }, "supergroup", 42);
    expect(h.sent()).toEqual([t("bot.group")]);
    expect(h.methods()).toContain("leaveChat");
    expect(h.spy.asked).toEqual([]);
  });

  it("чужой пользователь в личном чате (from.id ≠ chat.id) обслуживания не получает", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    const before = h.sent().length;
    await h.raw(chatId, { text: "Привет" }, "private", chatId + 1);
    expect(h.sent()).toHaveLength(before);
    expect(h.spy.asked).toEqual([]);
  });

  it("заблокированному — понятное сообщение, данные не читаются", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    h.state.member.set(OWNER_A.userId, "blocked");
    await h.text(chatId, "Привет");
    expect(h.sent().at(-1)).toBe(t("bot.blocked"));
    expect(h.spy.asked).toEqual([]);
  });
});

describe("TG-05, TG-10, SEC-05: вопросы ассистенту", () => {
  it("ответ идёт потоком черновиков обычным текстом без Markdown; время отправки и 6 часов тишины уходят в chat", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    await h.text(chatId, "Сколько на кафе?");
    expect(h.spy.asked[0]).toMatchObject({ text: "Сколько на кафе?", idleMs: 6 * 3_600_000 });
    expect(h.spy.asked[0]?.sentAt.toISOString()).toBe("2026-11-01T22:30:00.000Z");
    const streamed = h.calls.filter(
      (c) => c.method === "sendMessageDraft" || c.method === "sendMessage",
    );
    const last = streamed.at(-1);
    expect(last?.payload["text"]).toBe("Вы потратили 412,30 BYN на кафе.");
    expect(streamed.every((c) => c.payload["parse_mode"] === undefined)).toBe(true);
  });

  it("черновики недоступны — ответ уходит одним сообщением", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    h.failing.add("sendMessageDraft");
    await h.text(chatId, "Сколько на кафе?");
    expect(h.sent().at(-1)).toBe("Вы потратили 412,30 BYN на кафе.");
  });

  it("/new начинает чистый диалог, /help подсказывает команды", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    await h.text(chatId, "/new");
    expect(h.spy.newConversations).toBe(1);
    expect(h.sent().at(-1)).toBe(t("bot.newConversation"));
    await h.text(chatId, "/help");
    expect(h.sent().at(-1)).toBe(t("bot.help"));
  });
});

describe("VOICE-01: голос", () => {
  it("с облачным согласием голос распознаётся и идёт агенту как текст", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    await h.raw(chatId, { voice: { file_id: "v", file_unique_id: "u", duration: 5 } });
    expect(h.spy.transcribed).toBe(1);
    expect(h.spy.asked.at(-1)?.text).toBe("Потратил пятнадцать рублей на кофе");
  });

  it("без облачного согласия — честный ответ, распознавание не вызывается", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    h.state.cloud = false;
    await h.raw(chatId, { voice: { file_id: "v", file_unique_id: "u", duration: 5 } });
    expect(h.sent().at(-1)).toBe(t("bot.voice.unavailable"));
    expect(h.spy.transcribed).toBe(0);
    expect(h.methods()).not.toContain("getFile");
  });

  it("длиннее 60 секунд — отказ по duration до скачивания", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    await h.raw(chatId, { voice: { file_id: "v", file_unique_id: "u", duration: 61 } });
    expect(h.sent().at(-1)).toBe(t("bot.voice.tooLong", { seconds: 60 }));
    expect(h.methods()).not.toContain("getFile");
  });
});

describe("TG-03, TG-04: чеки и выписки", () => {
  it("фото → самое большое из размеров принято как чек, карточка с кнопками «Верно / Изменить / Отменить»", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    h.state.ownReceipts.add(uuid(500));
    await h.raw(chatId, {
      photo: [
        { file_id: "small", file_unique_id: "a", width: 90, height: 90, file_size: 1000 },
        { file_id: "big", file_unique_id: "b", width: 1280, height: 960, file_size: 90_000 },
      ],
    });
    expect(h.spy.accepted).toEqual([
      { kind: "receipt-photo", name: "telegram-photo.jpg", bytes: 1000 },
    ]);
    expect(h.sent()).toContain(t("bot.receipt.received"));
    const card = h.calls.filter((c) => c.method === "sendMessage").at(-1);
    expect(card?.payload["text"]).toBe(
      `Евроопт · 10 позиций · ${formatMoney({ minor: 4730, currency: "BYN" })} ✓ сумма сходится`,
    );
    const rows = keyboardOf(card);
    expect(rows[0]?.map((b) => b.text)).toEqual(["Верно", "Изменить", "Отменить"]);
  });

  it("файл больше 20 МБ — «загрузите на сайте», приём не вызывается", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    await h.raw(chatId, {
      document: {
        file_id: "d",
        file_unique_id: "u",
        file_name: "big.pdf",
        mime_type: "application/pdf",
        file_size: 25 * 1024 * 1024,
      },
    });
    expect(h.sent().at(-1)).toBe(t("bot.tooLarge", { mb: 20 }));
    expect(h.spy.accepted).toEqual([]);
  });

  it("файл выписки → «Найдено 23 операции, 6 уже были загружены. Импортировать 17?» с кнопками", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    await h.raw(chatId, {
      document: {
        file_id: "d",
        file_unique_id: "u",
        file_name: "prior.pdf",
        mime_type: "application/pdf",
        file_size: 5000,
      },
    });
    expect(h.spy.accepted[0]).toMatchObject({ kind: "statement", name: "prior.pdf" });
    const preview = h.calls.filter((c) => c.method === "sendMessage").at(-1);
    expect(preview?.payload["text"]).toBe(
      "Найдено 23 операции, 6 уже были загружены. Импортировать 17?",
    );
    const rows = keyboardOf(preview);
    expect(rows[0]?.map((b) => b.text)).toEqual(["Импортировать 17", "Отмена"]);
  });

  it("кнопки: «Верно» подтверждает и убирает кнопки, «Отменить» удаляет, «Изменить» даёт ссылку на редактор", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    h.state.ownReceipts.add(uuid(500));
    await h.press(chatId, encodeCallback({ action: "receipt-confirm", id: uuid(500) }), "Карточка");
    const edit = h.calls.find((c) => c.method === "editMessageText");
    expect(edit?.payload["text"]).toBe(`Карточка\n\n${t("bot.receipt.confirmed")}`);
    await h.press(chatId, encodeCallback({ action: "receipt-edit", id: uuid(500) }));
    expect(h.sent().at(-1)).toContain(`http://127.0.0.1:8140/documents?open=${uuid(500)}`);
    await h.press(chatId, encodeCallback({ action: "receipt-cancel", id: uuid(500) }));
    expect(h.spy.cancelledReceipts).toEqual([uuid(500)]);
  });
});

describe("TG-03: карточка чека присылается один раз", () => {
  const ownerScope = () =>
    createScopedDb(
      db.pool,
      makeScope({
        userId: UserId.parse(OWNER_A.userId),
        householdId: HouseholdId.parse(OWNER_A.householdId),
      }),
    );

  it("чек ещё распознаётся — карточки нет; потом подписка воркера присылает её, повторная доставка — нет", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    h.state.ownReceipts.add(uuid(500));
    h.state.receiptStatus = "processing";
    await h.raw(chatId, { photo: [{ file_id: "p", file_unique_id: "p", width: 10, height: 10 }] });
    expect(h.sent()).toEqual([t("bot.start.linked"), t("bot.receipt.received")]);

    h.state.receiptStatus = "ok";
    const delivered: string[] = [];
    const sender = {
      send: async (_chat: number, text: string) => (delivered.push(text), 1),
      edit: async () => undefined,
    };
    expect(await h.handler.deliverReceipt(ownerScope(), uuid(500), sender)).toBe(true);
    expect(await h.handler.deliverReceipt(ownerScope(), uuid(500), sender)).toBe(true);
    expect(delivered).toHaveLength(1);
  });

  it("чек «не вышло» — объяснение вместо карточки, без кнопок", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    h.state.ownReceipts.add(uuid(500));
    h.state.receiptStatus = "failed";
    await h.raw(chatId, { photo: [{ file_id: "p", file_unique_id: "p", width: 10, height: 10 }] });
    expect(h.sent().at(-1)).toBe(t("bot.receipt.failed"));
    expect(keyboardOf(h.calls.filter((c) => c.method === "sendMessage").at(-1))).toEqual([]);
  });
});

describe("SEC-04: чужие id в кнопках", () => {
  it("чужой чек или решение в кнопке — «Не нашёл», ничего не изменено; ошибки без текстов в логе", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_B, chatId);
    // uuid(500) принадлежит «другому домохозяйству»: у владельца B его нет (ownReceipts пуст).
    await h.press(chatId, encodeCallback({ action: "receipt-cancel", id: uuid(500) }));
    await h.press(chatId, encodeCallback({ action: "receipt-confirm", id: uuid(500) }));
    expect(h.sent().filter((text) => text === t("bot.notFound"))).toHaveLength(2);
    expect(h.spy.cancelledReceipts).toEqual([]);
  });

  it("данные кнопки не нашей формы молча игнорируются", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    const before = h.calls.length;
    await h.press(chatId, "rk:не-uuid");
    expect(h.calls.slice(before).map((c) => c.method)).toEqual(["answerCallbackQuery"]);
  });
});

describe("TG-10: «сегодня» по времени отправки", () => {
  it("23:30 UTC 1 ноября — в Минске уже 2 ноября: так решает chat; здесь проверено, что бот передаёт время сообщения", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    await h.text(chatId, "Потратил 5 рублей");
    const at = h.spy.asked.at(-1)?.sentAt;
    expect(at && LocalDate.fromInstant(at, "Europe/Minsk")).toBe(LocalDate.parse("2026-11-02"));
  });
});
