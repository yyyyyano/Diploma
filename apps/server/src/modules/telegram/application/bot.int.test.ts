// TG-01…05, TG-10, TG-11, VOICE-01, AUTH-11, SEC-05 через настоящий grammY: обновления — `bot.handleUpdate`, вызовы Bot API
// пишет трансформер (сети нет, NFR-11), БД — настоящий Postgres (привязки, коды), соседи — управляемые подмены.
import { LocalDate, HouseholdId, makeScope, UserId } from "@kosht/kernel";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { CONSENT_VERSIONS, createT, createTelegramT, formatMoney } from "@kosht/i18n";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { decodeCallback, encodeCallback, modelTag } from "../domain/callback-data.ts";
import { makeNotificationDelivery } from "./notification-channel.ts";
import type { TelegramDeps } from "./deps.ts";
import { makeBotHandler } from "./handler.ts";
import { makeLinkOps } from "./link.ts";
import { FileTooLargeError } from "./ports.ts";
import { saveBotName } from "../infrastructure/db/telegram.repo.ts";
import { createBot } from "../infrastructure/bot/bot-runtime.ts";

const t = createTelegramT();
const TOKEN = "111111:test-token";
const BOT = {
  id: 111111,
  is_bot: true,
  first_name: "Кошт",
  username: "kosht_test_bot",
};

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
    undone: [] as string[],
    chosen: [] as (string | null)[],
    charts: [] as unknown[],
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
    streamExtra: [] as { type: string; data?: unknown }[],
    limits: [] as { categoryKey: string; percent: number; spent: unknown; limit: unknown }[],
    undoable: undefined as string | undefined,
    undoResult: "undone" as "undone" | "already-undone" | "conflict",
    answerUndoToken: null as string | null,
    models: [] as { id: string; provider: string; model: string; cloud: boolean }[],
    selectedModel: null as string | null,
    weekly: null as null | Record<string, unknown>,
    resetLinks: 0,
  };
  const byn = (minor: number) => ({ minor, currency: "BYN" });
  const stream = (text: string) =>
    new ReadableStream<{ type: string; id?: string; delta?: string }>({
      start(controller) {
        controller.enqueue({ type: "start" });
        for (const part of text.match(/.{1,7}/gsu) ?? []) {
          controller.enqueue({ type: "text-delta", id: "t", delta: part });
        }
        for (const extra of state.streamExtra) controller.enqueue(extra as never);
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
      rateLimiter: { enforce: async () => undefined },
      jobs: { enqueue: async () => undefined },
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
        issueResetLink: async () => {
          state.resetLinks += 1;
          return { link: "http://127.0.0.1:8140/recovery?token=abc", minutes: 60 };
        },
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
          return { status: reply, undoToken: state.answerUndoToken };
        },
        lastUndoable: async () => state.undoable,
        undo: async (_s: unknown, token: string) => {
          spy.undone.push(token);
          if (state.undoResult === "conflict") throw new AppError("CONFLICT");
          return state.undoResult;
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
      dashboard: {
        overview: async () => ({
          accounts: {
            items: [{ name: "Наличные", bank: null, mask: null, balance: byn(12_000) }],
            total: { amount: byn(12_000) },
          },
          freeBalance: { amount: byn(84_000), months: 3 },
          limits: state.limits,
          daysLeft: 10,
        }),
      },
      weekly: { latest: async () => state.weekly },
      categories: {
        list: async () => ({ items: [{ ref: { type: "system", code: "cafes" }, name: null }] }),
      },
      llm: {
        modelChoice: {
          view: async () => ({ items: state.models, selected: state.selectedModel }),
          choose: async (_s: unknown, modelId: string | null) => {
            spy.chosen.push(modelId);
            state.selectedModel = modelId;
          },
        },
      },
      notifications: { get: async () => [] },
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
    nt: createT(),
    renderChart: async (chart) => {
      spy.charts.push(chart);
      return new Uint8Array([137, 80, 78, 71]);
    },
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
    { botInfo: BOT as never },
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
    deps,
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

describe("TG-07, TG-08: быстрые команды", () => {
  const linked = async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    return { h, chatId };
  };
  const plain = (text: string) => text.replaceAll("\u00A0", " ");

  it("/balance — остатки и свободный остаток, ссылка на сайт текстом (адрес локальный)", async () => {
    const { h, chatId } = await linked();
    await h.text(chatId, "/balance");
    const text = plain(h.sent().at(-1) ?? "");
    expect(text).toContain("На счетах: 120,00 BYN");
    expect(text).toContain("Свободный остаток: 840,00 BYN");
    expect(text).toContain("Открыть на сайте: http://127.0.0.1:8140/home");
  });

  it("/limits — строки с названиями категорий и картинка графика с подписью; подписи — в тексте", async () => {
    const { h, chatId } = await linked();
    h.state.limits = [
      {
        categoryKey: "system:cafes",
        percent: 84,
        spent: { minor: 42_000, currency: "BYN" },
        limit: { minor: 50_000, currency: "BYN" },
      },
    ];
    await h.text(chatId, "/limits");
    expect(plain(h.sent().at(-1) ?? "")).toContain(
      "«Кафе, рестораны и доставка»: 84% — 420,00 BYN из 500,00 BYN",
    );
    const photo = h.calls.find((c) => c.method === "sendPhoto");
    expect(String(photo?.payload["caption"])).toContain("Кафе, рестораны и доставка — 84%");
    expect(h.spy.charts).toHaveLength(1);
  });

  it("/week — заголовок недели и текст сводки; сводки нет — подсказка", async () => {
    const { h, chatId } = await linked();
    await h.text(chatId, "/week");
    expect(h.sent().at(-1)).toBe(t("bot.week.empty"));
    h.state.weekly = {
      weekStart: "2026-10-26",
      weekEnd: "2026-11-01",
      text: "Вы потратили 412,30 BYN.",
      spent: { amount: { minor: 41_230, currency: "BYN" } },
      categories: [{ name: "Такси", amount: { amount: { minor: 12_000, currency: "BYN" } } }],
    };
    await h.text(chatId, "/week");
    expect(h.sent().at(-1)).toContain(
      "Итоги недели 26.10.2026 — 01.11.2026\nВы потратили 412,30 BYN.",
    );
    expect(h.methods()).toContain("sendPhoto");
  });

  it("/undo: последнее действие бота отменяется; нечего — подсказка; позже правили — отказ с причиной", async () => {
    const { h, chatId } = await linked();
    await h.text(chatId, "/undo");
    expect(h.sent().at(-1)).toBe(t("bot.undo.nothing"));
    h.state.undoable = uuid(70);
    await h.text(chatId, "/undo");
    expect(h.spy.undone).toEqual([uuid(70)]);
    expect(h.sent().at(-1)).toBe(t("bot.undo.done"));
    h.state.undoResult = "conflict";
    await h.text(chatId, "/undo");
    expect(h.sent().at(-1)).toBe(t("bot.undo.conflict"));
  });

  it("/password — ссылка сброса присылается в чат; в /help есть кнопка «Сбросить пароль»", async () => {
    const { h, chatId } = await linked();
    await h.text(chatId, "/help");
    const help = h.calls.filter((c) => c.method === "sendMessage").at(-1);
    expect(keyboardOf(help)[0]?.map((b) => b.text)).toEqual(["Сбросить пароль"]);
    await h.text(chatId, "/password");
    expect(h.state.resetLinks).toBe(1);
    expect(h.sent().at(-1)).toContain("http://127.0.0.1:8140/recovery?token=abc");
    await h.press(chatId, encodeCallback({ action: "command", id: "password" }));
    expect(h.state.resetLinks).toBe(2);
  });

  it("/model: «Авто» и разрешённые модели; выбор по метке меняет модель и правит сообщение", async () => {
    const { h, chatId } = await linked();
    await h.text(chatId, "/model");
    expect(h.sent().at(-1)).toBe(t("bot.model.empty"));
    h.state.models = [
      { id: "groq/openai/gpt-oss-120b", provider: "groq", model: "gpt-oss-120b", cloud: true },
      { id: "local/qwen", provider: "llama", model: "qwen", cloud: false },
    ];
    await h.text(chatId, "/model");
    const menu = h.calls.filter((c) => c.method === "sendMessage").at(-1);
    expect(keyboardOf(menu).map((row) => row[0]?.text)).toEqual([
      "Авто",
      "gpt-oss-120b — облако",
      "qwen — на этом компьютере",
    ]);
    const gpt = keyboardOf(menu)[1]?.[0] as unknown as { callback_data: string } | undefined;
    await h.press(chatId, gpt?.callback_data ?? "");
    expect(h.spy.chosen).toEqual(["groq/openai/gpt-oss-120b"]);
    expect(h.calls.filter((c) => c.method === "editMessageText").at(-1)?.payload["text"]).toBe(
      t("bot.model.chosen", { name: "gpt-oss-120b" }),
    );
    await h.press(chatId, encodeCallback({ action: "model", id: "auto" }));
    expect(h.spy.chosen.at(-1)).toBeNull();
  });

  it("/model: метка модели, которой уже нет в списке (отозвано облако), — «выберите заново», выбор не меняется", async () => {
    const { h, chatId } = await linked();
    h.state.models = [{ id: "local/qwen", provider: "llama", model: "qwen", cloud: false }];
    await h.press(
      chatId,
      encodeCallback({ action: "model", id: modelTag("groq/openai/gpt-oss-120b") }),
    );
    expect(h.spy.chosen).toEqual([]);
    expect(h.calls.filter((c) => c.method === "editMessageText").at(-1)?.payload["text"]).toBe(
      t("bot.model.unavailable"),
    );
  });
});

describe("TG-08, TG-06: кнопки уведомлений и графики в ответах", () => {
  it("«Отменить» под уведомлением отменяет действие и убирает кнопки; «Да» с отменой — кнопка «Отменить»", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    await h.press(chatId, encodeCallback({ action: "undo", id: uuid(71) }), "Лимит");
    expect(h.spy.undone).toEqual([uuid(71)]);
    expect(h.sent().at(-1)).toBe(t("bot.undo.done"));

    h.state.answerUndoToken = uuid(72);
    await h.press(
      chatId,
      encodeCallback({ action: "decision-yes", id: uuid(73) }),
      "Перенести 13 операций?",
    );
    const edit = h.calls.filter((c) => c.method === "editMessageText").at(-1);
    expect(edit?.payload["text"]).toBe(`Перенести 13 операций?\n\n${t("bot.decision.yes")}`);
    const markup = edit?.payload["reply_markup"] as { inline_keyboard: { text: string }[][] };
    expect(markup.inline_keyboard[0]?.[0]?.text).toBe("Отменить");
  });

  it("график из ответа агента присылается картинкой с подписью текстом; больше двух — остальные на сайте", async () => {
    const h = harness();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    const chart = (title: string) => ({
      type: "data-chart",
      data: {
        kind: "bar",
        title,
        unit: "count",
        currency: null,
        labels: ["а", "б"],
        series: [{ name: "n", values: [1, 2] }],
      },
    });
    h.state.streamExtra = [chart("Первый"), chart("Второй"), chart("Третий")];
    await h.text(chatId, "Покажи график");
    const photos = h.calls.filter((c) => c.method === "sendPhoto");
    expect(photos).toHaveLength(2);
    expect(String(photos[0]?.payload["caption"])).toContain("Первый\nа — 1\nб — 2");
    expect(String(photos[1]?.payload["caption"])).toContain(
      "Открыть на сайте: http://127.0.0.1:8140/assistant",
    );
  });
});

describe("TG-06: канал доставки уведомлений", () => {
  const OWNER = OWNER_A;
  const notification = (extra: Record<string, unknown>) => ({
    id: uuid(80),
    kind: "limit",
    params: {
      category: "system:cafes",
      threshold: 80,
      percent: 84,
      spent: 42_000,
      limit: 50_000,
      daysLeft: 10,
    },
    objectRef: null,
    decisionId: null,
    undoToken: null,
    read: false,
    createdAt: "2026-11-01T09:00:00.000Z",
    ...extra,
  });

  async function delivery(items: unknown[], options: { token?: boolean } = {}) {
    await db.owner.query("delete from telegram_links");
    await db.owner.query("delete from telegram_link_codes");
    const h = harness();
    await link(h, OWNER, nextChat());
    const sentMessages: {
      chatId: number;
      text: string;
      keyboard: { text: string; data?: string }[][];
    }[] = [];
    const jobs: unknown[] = [];
    const deps = {
      ...h.deps,
      sender: async () =>
        options.token === false
          ? undefined
          : {
              send: async (chatId: number, text: string, keyboard?: never) => {
                sentMessages.push({ chatId, text, keyboard: (keyboard ?? []) as never });
                return 1;
              },
              edit: async () => undefined,
            },
      neighbours: { ...h.deps.neighbours, notifications: { get: async () => items } },
      platform: {
        ...h.deps.platform,
        jobs: {
          enqueue: async (_s: unknown, _job: unknown, payload: unknown) => void jobs.push(payload),
        },
      },
    } as never;
    const channel = makeNotificationDelivery(deps);
    const s = h.deps.scopedFor(OWNER);
    return { h, channel, s, sentMessages, jobs };
  }

  it("канал `telegram` только ставит задачу с id уведомлений (нагрузка — id, без текстов)", async () => {
    const { channel, s, jobs } = await delivery([]);
    expect(channel.channel.name).toBe("telegram");
    await channel.channel.deliver(s, [uuid(80)]);
    expect(jobs).toEqual([{ ids: [uuid(80)] }]);
  });

  it("лимит: текст с названием категории и суммами, кнопка «Показать лимиты»", async () => {
    const { channel, s, sentMessages } = await delivery([notification({})]);
    await channel.deliver(s, [uuid(80)]);
    const message = sentMessages[0];
    expect(message?.text.replaceAll("\u00A0", " ")).toContain(
      "Вы потратили 84% лимита на «Кафе, рестораны и доставка»: 420,00 BYN из 500,00 BYN",
    );
    expect(message?.keyboard[0]?.[0]?.text).toBe("Показать лимиты");
  });

  it("вопрос «Да / Нет» — кнопки с id решения (≤ 64 байт), «Отменить» — с токеном отмены", async () => {
    const { channel, s, sentMessages } = await delivery([
      notification({
        kind: "receipt-match",
        params: { store: "Евроопт", date: "12.10", bankDate: "13.10" },
        decisionId: uuid(81),
        undoToken: uuid(82),
      }),
    ]);
    await channel.deliver(s, [uuid(80)]);
    const rows = sentMessages[0]?.keyboard ?? [];
    expect(rows[0]?.map((b) => b.text)).toEqual(["Да", "Нет"]);
    expect(rows[1]?.[0]?.text).toBe("Это разные покупки");
    for (const row of rows)
      for (const button of row)
        expect(Buffer.byteLength(button.data ?? "")).toBeLessThanOrEqual(64);
    expect(decodeCallback(rows[0]?.[0]?.data ?? "")).toEqual({
      action: "decision-yes",
      id: uuid(81),
    });
  });

  it("итоги недели — текст сводки и ссылка на сайт", async () => {
    const { h, channel, s, sentMessages } = await delivery([
      notification({ kind: "weekly-summary", params: {} }),
    ]);
    h.state.weekly = {
      weekStart: "2026-10-26",
      weekEnd: "2026-11-01",
      text: "Вы потратили 412,30 BYN.",
    };
    await channel.deliver(s, [uuid(80)]);
    expect(sentMessages[0]?.text).toContain(
      "Итоги недели 26.10.2026 — 01.11.2026\nВы потратили 412,30 BYN.",
    );
    expect(sentMessages[0]?.text).toContain("Открыть на сайте: http://127.0.0.1:8140/home");
  });

  it("заблокированному, без согласия на Telegram и без токена — не отправляется", async () => {
    for (const setup of ["blocked", "no-consent", "no-token"] as const) {
      const { h, channel, s, sentMessages } = await delivery([notification({})], {
        token: setup !== "no-token",
      });
      if (setup === "blocked") h.state.member.set(OWNER.userId, "blocked");
      if (setup === "no-consent") h.state.consent.delete(OWNER.userId);
      await channel.deliver(s, [uuid(80)]);
      expect({ setup, sentMessages }).toEqual({ setup, sentMessages: [] });
    }
  });

  it("сбой отправки одного уведомления не роняет доставку остальных и не бросает наружу", async () => {
    const { h, channel, s, sentMessages } = await delivery([
      notification({ id: uuid(80) }),
      notification({ id: uuid(83) }),
    ]);
    let calls = 0;
    const original = h.deps.sender;
    void original;
    const failing = makeNotificationDelivery({
      ...h.deps,
      sender: async () => ({
        send: async (chatId: number, text: string) => {
          calls += 1;
          if (calls === 1) throw new Error("Forbidden: bot was blocked by the user");
          sentMessages.push({ chatId, text, keyboard: [] });
          return 1;
        },
        edit: async () => undefined,
      }),
      neighbours: {
        ...h.deps.neighbours,
        notifications: {
          get: async () => [notification({ id: uuid(80) }), notification({ id: uuid(83) })],
        },
      },
    } as never);
    await failing.deliver(s, [uuid(80), uuid(83)]);
    expect(sentMessages).toHaveLength(1);
    void channel;
  });
});

describe("AUTH-05, TG-09: ссылка сброса из админки — в бот", () => {
  async function resetSetup(options: { token?: boolean } = {}) {
    await db.owner.query("delete from telegram_links");
    await db.owner.query("delete from telegram_link_codes");
    const h = harness();
    const sent: { chatId: number; text: string }[] = [];
    const ops = makeLinkOps({
      ...h.deps,
      sender: async () =>
        options.token === false
          ? undefined
          : {
              send: async (chatId: number, text: string) => (sent.push({ chatId, text }), 1),
              edit: async () => undefined,
            },
    });
    return { h, ops, sent };
  }

  it("подключён, активен, согласие есть — ссылка уходит в чат владельца", async () => {
    const { h, ops, sent } = await resetSetup();
    const chatId = nextChat();
    await link(h, OWNER_A, chatId);
    expect(
      await ops.sendResetLink(OWNER_A.userId, "http://127.0.0.1:8140/recovery?token=x", 60),
    ).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe(chatId);
    expect(sent[0]?.text).toContain("http://127.0.0.1:8140/recovery?token=x");
  });

  it("Telegram не подключён, заблокирован, согласие отозвано, токена нет, отправка упала — false (ссылку покажут администратору)", async () => {
    const none = await resetSetup();
    expect(await none.ops.sendResetLink(OWNER_B.userId, "http://x/", 60)).toBe(false);

    const blocked = await resetSetup();
    await link(blocked.h, OWNER_A, nextChat());
    blocked.h.state.member.set(OWNER_A.userId, "blocked");
    expect(await blocked.ops.sendResetLink(OWNER_A.userId, "http://x/", 60)).toBe(false);

    const revoked = await resetSetup();
    await link(revoked.h, OWNER_A, nextChat());
    revoked.h.state.consent.delete(OWNER_A.userId);
    expect(await revoked.ops.sendResetLink(OWNER_A.userId, "http://x/", 60)).toBe(false);

    const noToken = await resetSetup({ token: false });
    await link(noToken.h, OWNER_A, nextChat());
    expect(await noToken.ops.sendResetLink(OWNER_A.userId, "http://x/", 60)).toBe(false);
    expect(noToken.sent).toEqual([]);

    const failing = await resetSetup();
    await link(failing.h, OWNER_A, nextChat());
    const broken = makeLinkOps({
      ...failing.h.deps,
      sender: async () => ({
        send: async () => Promise.reject(new Error("Forbidden")),
        edit: async () => undefined,
      }),
    });
    expect(await broken.sendResetLink(OWNER_A.userId, "http://x/", 60)).toBe(false);
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
