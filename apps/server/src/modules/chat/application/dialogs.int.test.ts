// CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-10, SEC-02, CHAT-08: диалоги, зависшие и идущие ответы, сбой потока, ограничение
// частоты, контекст страницы, вложения, «статья изменилась» — через настоящие сценарии chat на Postgres; агент и база
// законов — заглушки с управляемым ответом (модель не нужна).
import type { PageContext } from "@kosht/contract";
import { makeScope, type Scope } from "@kosht/kernel";
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import type { UIMessage, UIMessageChunk } from "ai";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  composeOnTestDb,
  waitForAppConnectionsClosed,
  type TestComposition,
} from "../../../main/__fixtures__/compose-on-test-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { AgentFacade } from "../../agent/index.ts";
import type { LegalBaseFacade } from "../../legal-base/index.ts";
import { insertMessage } from "../infrastructure/db/chat.repo.ts";
import { RATE_PER_MINUTE } from "../settings.ts";
import {
  makeConversations,
  makeHistory,
  makeRemoveConversation,
  makeRenameConversation,
} from "./dialogs.ts";
import { createLiveRuns } from "./live-runs.ts";
import { createRunRegistry } from "./runs.ts";
import { makeSendMessage } from "./send-message.ts";

type Run = Parameters<AgentFacade["run"]>[1];

let db: TestDb;
let stand: TestComposition;
let household = 700;

beforeAll(async () => {
  db = await createTestDb();
  stand = await composeOnTestDb(db, "api");
});
afterAll(async () => {
  await stand.close();
  await waitForAppConnectionsClosed(db);
  await db.drop();
});

/** Новый пользователь: у каждого теста свои диалоги и своя квота частоты. */
function user(): Scope {
  household += 1;
  return makeScope(testScope({ user: household, household }));
}

/** База законов-заглушка: какие версии «уже не текущие» (CHAT-10); `fail` — база недоступна. */
function legalBaseOf(stale: readonly string[], fail = false): Pick<LegalBaseFacade, "citations"> {
  return {
    citations: async (ids) => {
      if (fail) throw new Error("база законов недоступна");
      return ids.map((versionId) => ({
        versionId,
        isCurrent: !stale.includes(versionId),
      })) as never;
    },
  };
}

/** Стенд сценариев chat с заглушкой агента: `make` строит поток ответа по запуску. */
function chat(
  make: (run: Run) => ReadableStream<UIMessageChunk>,
  options: { readonly stale?: readonly string[]; readonly legalFails?: boolean } = {},
) {
  const runs = createRunRegistry(stand.composition.platform.log);
  const live = createLiveRuns();
  const agentCalls: Run[] = [];
  const agent = {
    run: async (_s: unknown, run: Run) => {
      agentCalls.push(run);
      return make(run);
    },
  } as unknown as AgentFacade;
  const platform = stand.composition.platform;
  const memory = memoryLogger();
  return {
    runs,
    live,
    agentCalls,
    memory,
    send: makeSendMessage({ agent, runs, live, platform }),
    history: makeHistory({
      live,
      legalBase: legalBaseOf(options.stale ?? [], options.legalFails ?? false),
      log: memory.log,
    }),
    conversations: makeConversations(),
    rename: makeRenameConversation(),
    remove: makeRemoveConversation({ live }),
    scoped: (scope: Scope) => platform.scoped(scope),
  };
}

const answer = (text: string, answeredBy?: UIMessage["metadata"]) => (run: Run) =>
  new ReadableStream<UIMessageChunk>({
    async start(controller) {
      controller.enqueue({ type: "start", messageMetadata: run.metadata });
      controller.enqueue({ type: "text-start", id: "t" });
      controller.enqueue({ type: "text-delta", id: "t", delta: text });
      await run.onFinish(
        {
          id: run.messageId,
          role: "assistant",
          parts: [{ type: "text", text }],
          ...(answeredBy === undefined ? {} : { metadata: answeredBy }),
        },
        false,
      );
      controller.close();
    },
  });

async function drain(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = [];
  try {
    for await (const chunk of stream) chunks.push(chunk);
  } catch {
    // Сбой потока — часть сценария: ответ сайту приходит куском error, здесь важно, что с ответом в БД.
  }
  return chunks;
}

describe("CHAT-01: название и список диалогов", () => {
  it("название — первое сообщение по границе слова до 60 знаков; список — свежие сверху с началом последнего ответа", async () => {
    const app = chat(answer("Записал: кафе, 15,00 BYN"));
    const scope = user();
    const s = app.scoped(scope);
    const longText =
      "Сколько я потратил на кафе за лето и сколько сэкономлю за год, если урежу на треть?";
    await drain(await app.send(s, { text: longText }, "r1"));
    await drain(await app.send(s, { text: "Потратил 15 рублей на кофе" }, "r2"));
    const { items } = await app.conversations(s);
    expect(items.map((item) => item.title)).toEqual([
      "Потратил 15 рублей на кофе",
      "Сколько я потратил на кафе за лето и сколько сэкономлю за…",
    ]);
    expect(items[0]?.preview).toBe("Записал: кафе, 15,00 BYN");
  });

  it("список видит только свои диалоги", async () => {
    const app = chat(answer("Готово."));
    const mine = app.scoped(user());
    await drain(await app.send(mine, { text: "мой вопрос" }, "r"));
    expect((await app.conversations(app.scoped(user()))).items).toEqual([]);
  });

  it("переименование меняет название; чужой диалог — NOT_FOUND", async () => {
    const app = chat(answer("Готово."));
    const s = app.scoped(user());
    const chunks = await drain(await app.send(s, { text: "вычет" }, "r"));
    const conversationId = (chunks[0] as { messageMetadata: { conversationId: string } })
      .messageMetadata.conversationId as never;
    await app.rename(s, { conversationId, title: "Вычет за учёбу Максима" });
    expect((await app.history(s, conversationId)).title).toBe("Вычет за учёбу Максима");
    await expect(
      app.rename(app.scoped(user()), { conversationId, title: "чужое" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("удаление убирает диалог и сообщения; повторное и чужое — NOT_FOUND", async () => {
    const app = chat(answer("Готово."));
    const s = app.scoped(user());
    const chunks = await drain(await app.send(s, { text: "вычет" }, "r"));
    const conversationId = (chunks[0] as { messageMetadata: { conversationId: string } })
      .messageMetadata.conversationId as never;
    await expect(app.remove(app.scoped(user()), { conversationId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await app.remove(s, { conversationId });
    expect((await app.conversations(s)).items).toEqual([]);
    await expect(app.history(s, conversationId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(app.remove(s, { conversationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("удаление диалога останавливает идущий в нём ответ", async () => {
    let signal: AbortSignal | undefined;
    const app = chat((run) => {
      signal = run.abortSignal;
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.enqueue({ type: "start", messageMetadata: run.metadata });
          run.abortSignal.addEventListener("abort", () => controller.close());
        },
      });
    });
    const s = app.scoped(user());
    const stream = await app.send(s, { text: "долгий вопрос" }, "r");
    const reader = stream.getReader();
    const first = await reader.read();
    const conversationId = (first.value as { messageMetadata: { conversationId: string } })
      .messageMetadata.conversationId as never;
    await app.remove(s, { conversationId });
    expect(signal?.aborted).toBe(true);
    await reader.cancel();
  });
});

describe("CHAT-02: идущие, зависшие и упавшие ответы", () => {
  it("«идёт» без живого запуска при чтении сохраняется как «оборван» (процесс упал)", async () => {
    const app = chat(answer("Готово."));
    const s = app.scoped(user());
    const chunks = await drain(await app.send(s, { text: "вопрос" }, "r"));
    const conversationId = (chunks[0] as { messageMetadata: { conversationId: string } })
      .messageMetadata.conversationId as never;
    // Строка «идёт», которой не владеет ни один запуск этого процесса.
    await insertMessage(s, { conversationId, role: "assistant", parts: [], status: "streaming" });
    const first = await app.history(s, conversationId);
    expect(first.messages.at(-1)?.status).toBe("interrupted");
    // Сохранено: следующее чтение не гадает заново.
    const raw = await db.owner.query<{ status: string }>(
      "select status from chat_messages where conversation_id = $1 order by created_at desc, id desc limit 1",
      [conversationId],
    );
    expect(raw.rows[0]?.status).toBe("interrupted");
  });

  it("идущий ответ виден как «идёт», после конца — «готов» и с пометкой, кто ответил", async () => {
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const app = chat((run) => {
      return new ReadableStream<UIMessageChunk>({
        async start(controller) {
          controller.enqueue({ type: "start", messageMetadata: run.metadata });
          await gate;
          await run.onFinish(
            {
              id: run.messageId,
              role: "assistant",
              parts: [{ type: "text", text: "Ответ" }],
              metadata: { answeredBy: { model: "zai/glm-4.7-flash", unavailable: ["groq/llama"] } },
            },
            false,
          );
          controller.close();
        },
      });
    });
    const s = app.scoped(user());
    const stream = await app.send(s, { text: "вопрос" }, "r");
    const reader = stream.getReader();
    const first = await reader.read();
    const conversationId = (first.value as { messageMetadata: { conversationId: string } })
      .messageMetadata.conversationId as never;
    expect((await app.history(s, conversationId)).messages.at(-1)?.status).toBe("streaming");
    finish();
    for (;;) if ((await reader.read()).done) break;
    const done = (await app.history(s, conversationId)).messages.at(-1);
    expect(done).toMatchObject({
      status: "complete",
      answeredBy: { model: "zai/glm-4.7-flash", unavailable: ["groq/llama"] },
    });
  });

  it("сбой посреди потока не оставляет ответ «идёт»: он «оборван»", async () => {
    const app = chat(
      (run) =>
        new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: "start", messageMetadata: run.metadata });
          },
          pull() {
            throw new Error("провайдер оборвал поток");
          },
        }),
    );
    const s = app.scoped(user());
    const chunks = await drain(await app.send(s, { text: "вопрос" }, "r"));
    expect(chunks.at(-1)).toMatchObject({ type: "error" });
    const conversationId = (chunks[0] as { messageMetadata: { conversationId: string } })
      .messageMetadata.conversationId as never;
    await vi.waitFor(async () =>
      expect((await app.history(s, conversationId)).messages.at(-1)?.status).toBe("interrupted"),
    );
    // Состояние записано самим запуском, а не угадано чтением: «идёт» в базе нет.
    const raw = await db.owner.query<{ status: string }>(
      "select status from chat_messages where conversation_id = $1 and role = 'assistant'",
      [conversationId],
    );
    expect(raw.rows.map((row) => row.status)).toEqual(["interrupted"]);
  });
});

describe("SEC-02: ограничение частоты запросов к ассистенту", () => {
  it("сверх предела в минуту — RATE_LIMITED, отказанный вопрос не записан", async () => {
    const app = chat(answer("Готово."));
    const s = app.scoped(user());
    await stand.composition.platform.settings.set(RATE_PER_MINUTE, 2);
    try {
      await drain(await app.send(s, { text: "раз" }, "r1"));
      await drain(await app.send(s, { text: "два" }, "r2"));
      await expect(app.send(s, { text: "три" }, "r3")).rejects.toMatchObject({
        code: "RATE_LIMITED",
      });
      const titles = (await app.conversations(s)).items.map((item) => item.title);
      expect(titles).toEqual(expect.arrayContaining(["раз", "два"]));
      expect(titles).not.toContain("три");
    } finally {
      await stand.composition.platform.settings.reset(RATE_PER_MINUTE);
    }
  });

  it("предел — на пользователя: другой пользователь пишет свободно", async () => {
    const app = chat(answer("Готово."));
    await stand.composition.platform.settings.set(RATE_PER_MINUTE, 1);
    try {
      const first = await drain(await app.send(app.scoped(user()), { text: "первый" }, "r1"));
      const second = await drain(await app.send(app.scoped(user()), { text: "второй" }, "r2"));
      expect([first.at(-1)?.type, second.at(-1)?.type]).toEqual(["text-delta", "text-delta"]);
    } finally {
      await stand.composition.platform.settings.reset(RATE_PER_MINUTE);
    }
  });
});

describe("CHAT-08: контекст страницы доходит до агента", () => {
  it("на дашборде за сентябрь агент получает маршрут и период", async () => {
    let seen: PageContext | undefined;
    const app = chat((run) => {
      seen = run.page;
      return answer("Готово.")(run);
    });
    const page = { route: "/home", params: { period: "2026-09" } };
    await drain(
      await app.send(app.scoped(user()), { text: "почему так много на такси?", page }, "r"),
    );
    expect(seen).toEqual(page);
  });
});

const lawAnswerPart = (versionIds: string[]) => ({
  type: "data-law-answer",
  data: {
    outcome: "cited",
    parts: [{ type: "text", text: "Срок — 14 дней." }],
    citations: [],
    notices: [],
    versionIds,
  },
});

/** Диалог с сохранённым ответом `parts` (как после правового вопроса). */
async function dialogWithAnswer(
  app: ReturnType<typeof chat>,
  parts: unknown[],
): Promise<{ s: ReturnType<typeof app.scoped>; conversationId: never }> {
  const s = app.scoped(user());
  const chunks = await drain(await app.send(s, { text: "вопрос" }, "r"));
  const conversationId = (chunks[0] as { messageMetadata: { conversationId: string } })
    .messageMetadata.conversationId as never;
  await db.owner.query(
    "update chat_messages set parts = $2::jsonb where conversation_id = $1 and role = 'assistant'",
    [conversationId, JSON.stringify(parts)],
  );
  return { s, conversationId };
}

describe("CHAT-10: «статья изменилась после ответа»", () => {
  it("ответ называет версии, заменённые новой редакцией; ответ без таких версий — без пометки", async () => {
    const app = chat(answer("Готово."), { stale: ["v2"] });
    const { s, conversationId } = await dialogWithAnswer(app, [lawAnswerPart(["v1", "v2"])]);
    const [question, reply] = (await app.history(s, conversationId)).messages;
    expect(reply?.changedVersionIds).toEqual(["v2"]);
    expect(question?.changedVersionIds).toBeUndefined();
    const fresh = await dialogWithAnswer(app, [lawAnswerPart(["v1"])]);
    expect(
      (await app.history(fresh.s, fresh.conversationId)).messages.at(-1)?.changedVersionIds,
    ).toBeUndefined();
  });

  it("база законов недоступна — диалог читается без пометки, в лог — ключ события", async () => {
    const app = chat(answer("Готово."), { legalFails: true });
    const { s, conversationId } = await dialogWithAnswer(app, [lawAnswerPart(["v1"])]);
    const messages = (await app.history(s, conversationId)).messages;
    expect(messages.at(-1)?.changedVersionIds).toBeUndefined();
    expect(app.memory.lines().some((line) => line["msg"] === "chat.law-check-failed")).toBe(true);
  });
});

describe("CHAT-04: строгие части в истории", () => {
  it("испорченная данные-часть не доходит до сайта, остальные части на месте; в лог — ключ без текста", async () => {
    const app = chat(answer("Готово."));
    const text = { type: "text", text: "Вот график" };
    const broken = { type: "data-chart", data: { kind: "bar", title: "x", series: [] } };
    const { s, conversationId } = await dialogWithAnswer(app, [text, broken]);
    const reply = (await app.history(s, conversationId)).messages.at(-1);
    expect(reply?.parts).toEqual([text]);
    const logged = app.memory.lines().find((line) => line["msg"] === "chat.part-dropped");
    expect(logged).toMatchObject({ count: 1 });
    expect(app.memory.text()).not.toContain("Вот график");
  });
});

describe("CHAT-03: вложения в сообщении", () => {
  const receipt = { kind: "receipt" as const, id: "0190f0a0-0000-7000-8000-000000000011" };
  const statement = { kind: "statement" as const, id: "0190f0a0-0000-7000-8000-000000000012" };

  it("вопрос с вложением: карточки идут в потоке сразу за start и сохраняются перед текстом агента; агент знает о вложении", async () => {
    const app = chat(answer("Чек распознан."));
    const s = app.scoped(user());
    const chunks = await drain(
      await app.send(s, { text: "Что в чеке?", attachments: [receipt] }, "r"),
    );
    expect(chunks.slice(0, 2).map((chunk) => chunk.type)).toEqual(["start", "data-attachment"]);
    expect(chunks[1]).toMatchObject({ data: receipt });
    const conversationId = (chunks[0] as { messageMetadata: { conversationId: string } })
      .messageMetadata.conversationId as never;
    const reply = (await app.history(s, conversationId)).messages.at(-1);
    expect(reply?.parts).toEqual([
      { type: "data-attachment", data: receipt },
      { type: "text", text: "Чек распознан." },
    ]);
    // Агент видит вложение в последнем вопросе; в БД вопрос остался текстом.
    const asked = app.agentCalls[0]?.messages.at(-1);
    expect(asked?.parts).toEqual([
      { type: "text", text: "Что в чеке?" },
      { type: "data-attachment", data: receipt },
    ]);
    const stored = (await app.history(s, conversationId)).messages[0];
    expect(stored?.parts).toEqual([{ type: "text", text: "Что в чеке?" }]);
  });

  it("одни вложения: модель не зовётся, ответ — карточки, диалог без названия, ответ «готов»", async () => {
    const app = chat(answer("не должно быть"));
    const s = app.scoped(user());
    const chunks = await drain(
      await app.send(s, { text: "", attachments: [receipt, statement] }, "r"),
    );
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "data-attachment",
      "data-attachment",
      "finish",
    ]);
    expect(app.agentCalls).toHaveLength(0);
    const conversationId = (chunks[0] as { messageMetadata: { conversationId: string } })
      .messageMetadata.conversationId as never;
    const history = await app.history(s, conversationId);
    expect(history.title).toBeNull();
    expect(history.messages.map((message) => [message.role, message.status])).toEqual([
      ["user", "complete"],
      ["assistant", "complete"],
    ]);
    expect(history.messages[0]?.parts).toEqual([]);
    expect(history.messages[1]?.parts).toEqual([
      { type: "data-attachment", data: receipt },
      { type: "data-attachment", data: statement },
    ]);
  });
});
