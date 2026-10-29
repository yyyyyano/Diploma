// LLM-03, LLM-05, LLM-10: «цепочка как одна модель» на MockLanguageModelV4 — без БД и сети. Лимитёр получает журнал
// функцией, часы — свои, поэтому окна и размыкатель проверяются детерминированно.
import { APICallError } from "@ai-sdk/provider";
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "@kosht/testing";
import { simulateReadableStream } from "ai";
import { describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { RateLimits, UsageWindows } from "../infrastructure/db/llm.repo.ts";
import { chainedModel, type ChainEntry, type ChainEvent } from "./chained-model.ts";
import { LlmInTransactionError } from "./errors.ts";
import { createLimiter } from "./limiter.ts";

const NO_LIMITS: RateLimits = { rpm: null, tpm: null, rpd: null, tpd: null };
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const PROMPT = [{ role: "user" as const, content: [{ type: "text" as const, text: "Привет" }] }];

function textModel(text: string, headers?: Record<string, string>): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
      ...(headers === undefined ? {} : { response: { headers } }),
    }),
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV4StreamPart>({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: text },
          { type: "text-end", id: "1" },
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
      ...(headers === undefined ? {} : { response: { headers } }),
    }),
  });
}

function failing(error: unknown): LanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
    doStream: async () => {
      throw error;
    },
  });
}

/** Поток, который сразу сообщает об ошибке (после начала потока, но до первого куска текста). */
function errorInStream(error: unknown): LanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV4StreamPart>({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "error", error },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    }),
  });
}

const apiError = (statusCode: number, responseHeaders: Record<string, string> = {}) =>
  new APICallError({
    message: "ошибка провайдера",
    url: "https://provider.test/v1/chat",
    requestBodyValues: {},
    statusCode,
    responseHeaders,
  });

function entry(
  id: string,
  model: LanguageModelV4,
  patch: { cloud?: boolean; limits?: Partial<RateLimits> } = {},
): ChainEntry {
  return {
    record: {
      id,
      provider: id.split("/")[0] ?? id,
      cloud: patch.cloud ?? true,
      limits: { ...NO_LIMITS, ...patch.limits },
    },
    model,
  };
}

function setup(
  entries: ChainEntry[],
  options: { journal?: Map<string, UsageWindows>; timeoutMs?: number } = {},
) {
  let now = Date.parse("2026-10-29T09:00:00Z");
  const events: ChainEvent[] = [];
  const limiter = createLimiter({
    now: () => new Date(now),
    usage: async () => options.journal ?? new Map(),
  });
  const model = chainedModel(entries, {
    limiter,
    timeoutMs: () => options.timeoutMs ?? 5000,
    onEvent: (event) => events.push(event),
  });
  return { model, events, advance: (ms: number) => (now += ms) };
}

async function drain(stream: ReadableStream<LanguageModelV4StreamPart>) {
  const parts: LanguageModelV4StreamPart[] = [];
  for (const reader = stream.getReader(); ;) {
    const next = await reader.read();
    if (next.done) return parts;
    parts.push(next.value);
  }
}

const answer = (result: { content: readonly { type: string; text?: string }[] }) =>
  result.content.map((part) => part.text ?? "").join("");

describe("LLM-03: ошибка, 429 и таймаут до ответа — отвечает следующая модель", () => {
  it("ошибка первой — отвечает вторая, в метаданных названа недоступная", async () => {
    const { model, events } = setup([
      entry("groq/a", failing(apiError(500))),
      entry("zai/b", textModel("ответ Z.ai")),
    ]);
    const result = await model.doGenerate({ prompt: PROMPT });
    expect(answer(result)).toBe("ответ Z.ai");
    expect(result.providerMetadata).toEqual({ kosht: { model: "zai/b", unavailable: ["groq/a"] } });
    expect(events).toEqual([{ kind: "error", provider: "groq", model: "groq/a" }]);
  });

  it("отвечает первая — недоступных нет", async () => {
    const { model } = setup([entry("groq/a", textModel("раз")), entry("zai/b", textModel("два"))]);
    const result = await model.doGenerate({ prompt: PROMPT });
    expect(result.providerMetadata).toEqual({ kosht: { model: "groq/a", unavailable: [] } });
  });

  it("ошибка внутри потока до первого куска текста — поток начинает следующая модель", async () => {
    const { model } = setup([
      entry("groq/a", errorInStream(new Error("обрыв"))),
      entry("zai/b", textModel("ответ Z.ai")),
    ]);
    const { stream } = await model.doStream({ prompt: PROMPT });
    const parts = await drain(stream);
    expect(parts.filter((part) => part.type === "text-delta")).toEqual([
      { type: "text-delta", id: "1", delta: "ответ Z.ai" },
    ]);
    expect(parts.find((part) => part.type === "error")).toBeUndefined();
    expect(parts.find((part) => part.type === "finish")).toMatchObject({
      providerMetadata: { kosht: { model: "zai/b", unavailable: ["groq/a"] } },
    });
  });

  it("ошибка потока после первого куска — не переключается: два начала ответа пользователю не нужны", async () => {
    const broken = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream<LanguageModelV4StreamPart>({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "Нача" },
            { type: "error", error: new Error("обрыв посреди ответа") },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      }),
    });
    const { model } = setup([entry("groq/a", broken), entry("zai/b", textModel("другой ответ"))]);
    const parts = await drain((await model.doStream({ prompt: PROMPT })).stream);
    expect(parts.some((part) => part.type === "text-delta" && part.delta === "Нача")).toBe(true);
    expect(parts.some((part) => part.type === "error")).toBe(true);
    expect(parts.some((part) => part.type === "text-delta" && part.delta === "другой ответ")).toBe(
      false,
    );
  });

  it("таймаут первого куска — следующая модель, даже если первая не слушает сигнал отмены", async () => {
    const silent = new MockLanguageModelV4({ doStream: () => new Promise(() => undefined) });
    const { model, events } = setup([entry("groq/a", silent), entry("zai/b", textModel("успел"))], {
      timeoutMs: 20,
    });
    const parts = await drain((await model.doStream({ prompt: PROMPT })).stream);
    expect(parts.some((part) => part.type === "text-delta" && part.delta === "успел")).toBe(true);
    expect(events).toEqual([{ kind: "error", provider: "groq", model: "groq/a" }]);
  });

  it("таймаут у облачных и локальных моделей свой", async () => {
    const seen: boolean[] = [];
    const limiter = createLimiter({ now: () => new Date(), usage: async () => new Map() });
    const silent = new MockLanguageModelV4({ doGenerate: () => new Promise(() => undefined) });
    const model = chainedModel(
      [entry("llama/a", silent, { cloud: false }), entry("zai/b", textModel("облако"))],
      {
        limiter,
        timeoutMs: (cloud) => {
          seen.push(cloud);
          return cloud ? 5000 : 20;
        },
      },
    );
    expect(answer(await model.doGenerate({ prompt: PROMPT }))).toBe("облако");
    expect(seen).toEqual([false, true]);
  });

  it("все модели отказали — ошибка последней", async () => {
    const { model } = setup([
      entry("groq/a", failing(apiError(500))),
      entry("zai/b", failing(new Error("и вторая"))),
    ]);
    await expect(model.doGenerate({ prompt: PROMPT })).rejects.toThrow("и вторая");
  });

  it("«Стоп» пользователя — не сбой провайдера: следующая модель не зовётся", async () => {
    const stop = new AbortController();
    const second = textModel("не нужен");
    const cancelled = new MockLanguageModelV4({
      doGenerate: async () => {
        stop.abort();
        throw new Error("прервано");
      },
    });
    const { model, events } = setup([entry("groq/a", cancelled), entry("zai/b", second)]);
    await expect(model.doGenerate({ prompt: PROMPT, abortSignal: stop.signal })).rejects.toThrow(
      "прервано",
    );
    expect(second.doGenerateCalls).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it("вызов в транзакции — баг кода, а не сбой провайдера: цепочка его не скрывает", async () => {
    const second = textModel("не нужен");
    const { model } = setup([
      entry("groq/a", failing(new LlmInTransactionError())),
      entry("zai/b", second),
    ]);
    await expect(model.doGenerate({ prompt: PROMPT })).rejects.toBeInstanceOf(
      LlmInTransactionError,
    );
    expect(second.doGenerateCalls).toHaveLength(0);
  });

  it("цепочка без моделей — сервис недоступен", () => {
    const limiter = createLimiter({ now: () => new Date(), usage: async () => new Map() });
    expect(() => chainedModel([], { limiter, timeoutMs: () => 1 })).toThrow(AppError);
  });
});

describe("LLM-05: лимитёр и размыкатель", () => {
  const window = (patch: Partial<UsageWindows>): UsageWindows => ({
    requestsMinute: 0,
    tokensMinute: 0,
    requestsDay: 0,
    tokensDay: 0,
    ...patch,
  });

  it("минутный лимит запросов по журналу исчерпан — модель пропущена без вызова", async () => {
    const first = textModel("первая");
    const { model, events } = setup(
      [entry("groq/a", first, { limits: { rpm: 30 } }), entry("zai/b", textModel("вторая"))],
      { journal: new Map([["groq/a", window({ requestsMinute: 30, requestsDay: 30 })]]) },
    );
    const result = await model.doGenerate({ prompt: PROMPT });
    expect(answer(result)).toBe("вторая");
    expect(first.doGenerateCalls).toHaveLength(0);
    // Минутное окно — обычная работа цепочки, администратору тревога не нужна.
    expect(events).toEqual([]);
  });

  it("минутные токены по журналу и оценка вызова не помещаются в tpm — следующая модель", async () => {
    const first = textModel("первая");
    const { model } = setup(
      [entry("groq/a", first, { limits: { tpm: 8000 } }), entry("zai/b", textModel("вторая"))],
      { journal: new Map([["groq/a", window({ tokensMinute: 7990, tokensDay: 7990 })]]) },
    );
    expect(answer(await model.doGenerate({ prompt: PROMPT }))).toBe("вторая");
    expect(first.doGenerateCalls).toHaveLength(0);
  });

  it("суточный лимит исчерпан — следующая модель и событие «лимит» для администратора", async () => {
    const { model, events } = setup(
      [
        entry("groq/a", textModel("первая"), { limits: { rpd: 1000 } }),
        entry("zai/b", textModel("вторая")),
      ],
      { journal: new Map([["groq/a", window({ requestsDay: 1000 })]]) },
    );
    expect(answer(await model.doGenerate({ prompt: PROMPT }))).toBe("вторая");
    expect(events).toEqual([{ kind: "limit", provider: "groq", model: "groq/a" }]);
  });

  it("лимиты не опубликованы (null) — журнал не читается и модель не пропускается", async () => {
    let reads = 0;
    const limiter = createLimiter({
      now: () => new Date(),
      usage: async () => {
        reads += 1;
        return new Map();
      },
    });
    const model = chainedModel([entry("zai/b", textModel("ответ"))], {
      limiter,
      timeoutMs: () => 1000,
    });
    expect(answer(await model.doGenerate({ prompt: PROMPT }))).toBe("ответ");
    expect(reads).toBe(0);
  });

  it("429 с retry-after размыкает модель на это время; после срока она снова зовётся", async () => {
    let calls = 0;
    const flaky = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        if (calls === 1) throw apiError(429, { "retry-after": "30" });
        return {
          content: [{ type: "text", text: "groq снова жив" }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
    const { model, events, advance } = setup([
      entry("groq/a", flaky),
      entry("zai/b", textModel("Z.ai")),
    ]);
    expect(answer(await model.doGenerate({ prompt: PROMPT }))).toBe("Z.ai");
    expect(events).toEqual([{ kind: "limit", provider: "groq", model: "groq/a" }]);

    advance(10_000);
    expect(answer(await model.doGenerate({ prompt: PROMPT }))).toBe("Z.ai");
    expect(calls).toBe(1);

    advance(21_000);
    expect(answer(await model.doGenerate({ prompt: PROMPT }))).toBe("groq снова жив");
    expect(calls).toBe(2);
  });

  it("429 без retry-after — модель отдыхает минуту", async () => {
    const { model, advance } = setup([
      entry("groq/a", failing(apiError(429))),
      entry("zai/b", textModel("Z.ai")),
    ]);
    await model.doGenerate({ prompt: PROMPT });
    advance(59_000);
    const second = await model.doGenerate({ prompt: PROMPT });
    expect(second.providerMetadata).toEqual({ kosht: { model: "zai/b", unavailable: ["groq/a"] } });
  });

  it("заголовки x-ratelimit-*: остаток запросов 0 до сброса — модель пропущена, после сброса вернулась", async () => {
    const first = textModel("первая", {
      "x-ratelimit-remaining-requests": "0",
      "x-ratelimit-reset-requests": "1m26.4s",
      "x-ratelimit-remaining-tokens": "7000",
      "x-ratelimit-reset-tokens": "2s",
    });
    const { model, advance } = setup([entry("groq/a", first), entry("zai/b", textModel("вторая"))]);
    expect(answer(await model.doGenerate({ prompt: PROMPT }))).toBe("первая");
    expect(answer(await model.doGenerate({ prompt: PROMPT }))).toBe("вторая");
    advance(87_000);
    expect(answer(await model.doGenerate({ prompt: PROMPT }))).toBe("первая");
  });

  it("запросы в полёте считаются в окне: две параллельные при rpm = 1 — вторая уходит дальше", async () => {
    let release: () => void = () => undefined;
    const slow = new MockLanguageModelV4({
      doGenerate: () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              content: [{ type: "text", text: "медленная" }],
              finishReason: { unified: "stop", raw: undefined },
              usage,
              warnings: [],
            });
        }),
    });
    const { model } = setup([
      entry("groq/a", slow, { limits: { rpm: 1 } }),
      entry("zai/b", textModel("быстрая")),
    ]);
    const firstCall = model.doGenerate({ prompt: PROMPT });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(answer(await model.doGenerate({ prompt: PROMPT }))).toBe("быстрая");
    release();
    expect(answer(await firstCall)).toBe("медленная");
  });
});
