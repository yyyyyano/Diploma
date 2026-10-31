// AGT-06, AGT-07, PROF-04: «да» на ожидающее решение и выбор варианта дозапроса распознаёт код до агента; нет ожидающего
// решения — «да» остаётся обычным текстом.
import { testScope } from "@kosht/testing";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { answerShort, openQuestion, pendingDecisionId, type ShortDeps } from "./short-answers.ts";

const s = { scope: testScope() } as ScopedDb;
const user = (id: string, text: string): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});
const pendingPart = (decisionId: string) =>
  ({
    type: "tool-delete_transaction",
    toolCallId: `c-${decisionId}`,
    state: "output-available",
    input: {},
    output: { ok: true, pending: { decisionId, count: 3 } },
  }) as never;
const askPart = {
  type: "tool-ask_user",
  toolCallId: "ask-1",
  state: "input-available",
  input: {
    factKey: "housingQueue",
    question: "Вы состояли на учёте нуждающихся?",
    options: [
      { label: "Да, состоял", value: "now" },
      { label: "Нет", value: "no" },
    ],
  },
} as never;
const assistant = (...parts: UIMessage["parts"]): UIMessage => ({
  id: "a1",
  role: "assistant",
  parts,
});

function setup(status: "pending" | "yes" | "no" | "missing" = "pending") {
  const answers: unknown[] = [];
  const recorded: unknown[] = [];
  const memory = memoryLogger();
  const handlers = {
    log: memory.log,
    actions: {
      decision: async () => {
        if (status === "missing") throw new AppError("NOT_FOUND");
        return { status } as never;
      },
      answer: async (_s: unknown, id: string, reply: "yes" | "no") => {
        answers.push([id, reply]);
        return { status: reply, undoToken: reply === "yes" ? "undo-1" : null };
      },
    },
    profile: {
      recordAnswer: async (_s: unknown, input: unknown) => {
        recorded.push(input);
        return {} as never;
      },
    },
  };
  return { answers, recorded, memory, handlers, deps: handlers as unknown as ShortDeps };
}

describe("AGT-07: «да» на ожидающее решение", () => {
  const history = [user("u1", "удали вчерашнее"), assistant(pendingPart("d1")), user("u2", "да")];

  it("«да» → actions.answer(yes) и часть data-action-result с токеном «Отменить», без модели", async () => {
    const t = setup();
    const outcome = await answerShort(t.deps, s, { messages: history, channel: "web" });
    expect(outcome).toEqual({
      kind: "decision",
      data: { decisionId: "d1", status: "yes", undoToken: "undo-1" },
    });
    expect(t.answers).toEqual([["d1", "yes"]]);
  });

  it("«нет» → no, токена нет", async () => {
    const t = setup();
    const messages = [...history.slice(0, 2), user("u2", "Нет.")];
    expect(await answerShort(t.deps, s, { messages, channel: "web" })).toMatchObject({
      data: { status: "no", undoToken: null },
    });
  });

  it("развёрнутый ответ «да, но в августе» — вопрос агенту: решение не тронуто", async () => {
    const t = setup();
    const messages = [...history.slice(0, 2), user("u2", "да, но в августе")];
    expect(await answerShort(t.deps, s, { messages, channel: "web" })).toBeUndefined();
    expect(t.answers).toEqual([]);
  });

  it("решение уже отвечено или исчезло — «да» уходит агенту как обычный текст", async () => {
    expect(
      await answerShort(setup("yes").deps, s, { messages: history, channel: "web" }),
    ).toBeUndefined();
    expect(
      await answerShort(setup("missing").deps, s, { messages: history, channel: "web" }),
    ).toBeUndefined();
  });

  it("нет ожидающего решения в последнем ответе — «да» идёт агенту", async () => {
    const t = setup();
    const messages = [
      user("u1", "привет"),
      assistant({ type: "text", text: "Здравствуйте." }),
      user("u2", "да"),
    ];
    expect(await answerShort(t.deps, s, { messages, channel: "web" })).toBeUndefined();
    expect(t.answers).toEqual([]);
  });

  it("два ожидающих решения в одном ответе — неоднозначно: «да» идёт агенту", async () => {
    const t = setup();
    const messages = [
      user("u1", "удали"),
      assistant(pendingPart("d1"), pendingPart("d2")),
      user("u2", "да"),
    ];
    expect(pendingDecisionId(messages)).toBeUndefined();
    expect(await answerShort(t.deps, s, { messages, channel: "web" })).toBeUndefined();
  });

  it("обработчик «Да» отказал — честное «не получилось», без падения", async () => {
    const t = setup();
    t.handlers.actions.answer = async () => {
      throw new AppError("CONFLICT");
    };
    expect(await answerShort(t.deps, s, { messages: history, channel: "web" })).toEqual({
      kind: "failed",
    });
  });
});

describe("AGT-06, PROF-04: ответ на дозапрос", () => {
  const history = [
    user("u1", "Я купил квартиру в Минске, как вернуть налог?"),
    assistant(askPart),
    user("u2", "да"),
  ];

  it("«да» выбирает вариант — profile.recordAnswer с источником «чат» (id сообщения) и каналом", async () => {
    const t = setup();
    const outcome = await answerShort(t.deps, s, { messages: history, channel: "telegram" });
    expect(outcome).toEqual({ kind: "fact", factKey: "housingQueue" });
    expect(t.recorded).toEqual([
      {
        value: { key: "housingQueue", status: "now", since: null },
        messageId: "u2",
        channel: "telegram",
      },
    ]);
  });

  it("свободный ответ — не вариант: факт не записан, ответ идёт агенту", async () => {
    const t = setup();
    const messages = [...history.slice(0, 2), user("u2", "мы с женой на учёте с 2019 года")];
    expect(await answerShort(t.deps, s, { messages, channel: "web" })).toBeUndefined();
    expect(t.recorded).toEqual([]);
  });

  it("сбой записи факта не роняет ответ: агент получит вопрос как есть", async () => {
    const t = setup();
    t.handlers.profile.recordAnswer = async () => {
      throw new Error("сбой");
    };
    expect(await answerShort(t.deps, s, { messages: history, channel: "web" })).toBeUndefined();
  });

  it("openQuestion находит незакрытый вопрос, закрытый — нет", () => {
    expect(openQuestion(history)?.factKey).toBe("housingQueue");
    const closed = assistant({ ...(askPart as object), state: "output-available" } as never);
    expect(openQuestion([user("u1", "x"), closed, user("u2", "да")])).toBeUndefined();
  });
});
