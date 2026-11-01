// TG-05, AGT-11, TG-10: диалог бота — свой непрерывный; на сайте он не виден (список, история, переименование, отправка по
// id); `/new` и 6 часов тишины начинают новый; агент знает канал и «сегодня» по времени отправки сообщения.
import { LocalDate, makeScope, type Scope } from "@kosht/kernel";
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import type { UIMessageChunk } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composeOnTestDb,
  waitForAppConnectionsClosed,
  type TestComposition,
} from "../../../main/__fixtures__/compose-on-test-db.ts";
import type { AgentFacade } from "../../agent/index.ts";
import { makeConversations, makeHistory, makeRenameConversation } from "./dialogs.ts";
import { createLiveRuns } from "./live-runs.ts";
import { makeStartNewConversation } from "./new-conversation.ts";
import { createRunRegistry } from "./runs.ts";
import { makeSendMessage } from "./send-message.ts";

type Run = Parameters<AgentFacade["run"]>[1];

let db: TestDb;
let stand: TestComposition;
let household = 1700;

beforeAll(async () => {
  db = await createTestDb();
  stand = await composeOnTestDb(db, "api");
});
afterAll(async () => {
  await stand.close();
  await waitForAppConnectionsClosed(db);
  await db.drop();
});

function user(): Scope {
  household += 1;
  return makeScope(testScope({ user: household, household }));
}

const HOUR = 3_600_000;
const IDLE = 6 * HOUR;

function app() {
  const platform = stand.composition.platform;
  const live = createLiveRuns();
  const calls: Run[] = [];
  const agent = {
    run: async (_s: unknown, run: Run) => {
      calls.push(run);
      return new ReadableStream<UIMessageChunk>({
        async start(controller) {
          controller.enqueue({ type: "start", messageMetadata: run.metadata });
          await run.onFinish(
            { id: run.messageId, role: "assistant", parts: [{ type: "text", text: "Готово." }] },
            false,
          );
          controller.close();
        },
      });
    },
  } as unknown as AgentFacade;
  return {
    calls,
    send: makeSendMessage({
      agent,
      runs: createRunRegistry(platform.log),
      live,
      platform,
      receipts: { existing: async () => [] },
      statements: { existing: async () => [] },
    }),
    startNew: makeStartNewConversation(),
    conversations: makeConversations(),
    history: makeHistory({
      live,
      legalBase: { citations: async () => [] },
      log: platform.log,
    }),
    rename: makeRenameConversation(),
    scoped: (scope: Scope) => platform.scoped(scope),
  };
}

async function drain(stream: ReadableStream<UIMessageChunk>): Promise<void> {
  for await (const chunk of stream) void chunk;
}

const telegram = (text: string, sentAt: string) => ({
  text,
  channel: "telegram" as const,
  sentAt: new Date(sentAt),
  idleMs: IDLE,
});

const conversationOf = (run: Run | undefined) => run?.metadata.conversationId;

describe("TG-05: диалог бота", () => {
  it("тишина короче 6 часов — тот же диалог, агент видит прежние сообщения", async () => {
    const a = app();
    const s = a.scoped(user());
    await drain(await a.send(s, telegram("Привет", "2026-11-01T08:00:00Z"), "r1"));
    await drain(await a.send(s, telegram("А лимиты?", "2026-11-01T13:00:00Z"), "r2"));
    expect(conversationOf(a.calls[1])).toBe(conversationOf(a.calls[0]));
    expect(a.calls[1]?.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("тишина больше 6 часов — новый диалог с чистым контекстом", async () => {
    const a = app();
    const s = a.scoped(user());
    await drain(await a.send(s, telegram("Привет", "2026-11-01T08:00:00Z"), "r1"));
    await drain(await a.send(s, telegram("Снова я", "2026-11-01T14:00:01Z"), "r2"));
    expect(conversationOf(a.calls[1])).not.toBe(conversationOf(a.calls[0]));
    expect(a.calls[1]?.messages).toHaveLength(1);
  });

  it("/new: следующий вопрос — в новом диалоге, хотя тишины не было", async () => {
    const a = app();
    const s = a.scoped(user());
    await drain(await a.send(s, telegram("Привет", "2026-11-01T08:00:00Z"), "r1"));
    await a.startNew(s, "telegram");
    await drain(await a.send(s, telegram("Чистый лист", "2026-11-01T08:01:00Z"), "r2"));
    expect(conversationOf(a.calls[1])).not.toBe(conversationOf(a.calls[0]));
    expect(a.calls[1]?.messages).toHaveLength(1);
  });

  it("агент знает канал, а «сегодня» — по времени отправки, а не обработки (TG-10)", async () => {
    const a = app();
    const s = a.scoped(user());
    // 22:30 UTC первого ноября — в Минске уже второе (UTC+3).
    await drain(await a.send(s, telegram("Потратил 5 рублей", "2026-11-01T22:30:00Z"), "r1"));
    expect(a.calls[0]?.channel).toBe("telegram");
    expect(a.calls[0]?.today).toBe(LocalDate.parse("2026-11-02"));
  });
});

describe("AGT-11, TG-05: на сайте диалог бота не показывается", () => {
  it("список, история без id, переименование и отправка по id его не видят", async () => {
    const a = app();
    const s = a.scoped(user());
    await drain(await a.send(s, telegram("Привет", "2026-11-01T08:00:00Z"), "r1"));
    const id = conversationOf(a.calls[0]) as never;
    expect((await a.conversations(s)).items).toEqual([]);
    expect((await a.history(s, undefined)).messages).toEqual([]);
    await expect(a.rename(s, { conversationId: id, title: "Чужое" })).rejects.toMatchObject({
      message: "NOT_FOUND",
    });
    await expect(
      a.send(s, { text: "в чужой диалог", conversationId: id }, "r2"),
    ).rejects.toMatchObject({
      message: "NOT_FOUND",
    });
  });
});
