// PRIV-03, PRIV-04: облачная модель за обёрткой — в промпте метки (текст, аргументы и результаты инструментов),
// изображения без метаданных; в ответе (текст, поток, аргументы инструментов) — настоящие значения.
import type { LanguageModelV4Prompt, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4, testScope } from "@kosht/testing";
import { simulateReadableStream } from "ai";
import { describe, expect, it } from "vitest";
import { maskedModel } from "./masked-model.ts";
import { createMasker } from "./masker.ts";

const scope = testScope();
const IBAN = "BY20 AKBB 3012 0000 0418 8000 0000";
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const finish = {
  type: "finish" as const,
  finishReason: { unified: "stop" as const, raw: undefined },
  usage,
};

function wrap(inner: MockLanguageModelV4, sanitized: string[] = []) {
  return maskedModel(inner, {
    masker: createMasker({ names: { names: async () => ["Анна"] } }),
    scope,
    sanitizeFile: async (part) => {
      sanitized.push(part.mediaType);
      return { ...part, filename: "очищено" };
    },
  });
}

const PROMPT: LanguageModelV4Prompt = [
  { role: "system", content: `Помогай пользователю Анна. Счёт ${IBAN}.` },
  { role: "user", content: [{ type: "text", text: "Сколько потратила Анна? Итого 8,47 BYN" }] },
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "search_operations",
        input: { query: IBAN },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "search_operations",
        output: {
          type: "json",
          value: { rows: [{ payee: "Анна", account: IBAN, amount: "8,47" }] },
        },
      },
    ],
  },
];

describe("PRIV-03: что уходит облачной модели", () => {
  it("система, текст пользователя, аргументы и результаты инструментов — с метками; служебное и суммы — как есть", async () => {
    const inner = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      }),
    });
    await wrap(inner).doGenerate({ prompt: PROMPT });
    const sent = JSON.stringify(inner.doGenerateCalls[0]?.prompt);
    expect(sent).not.toContain("Анна");
    expect(sent).not.toContain("BY20");
    expect(sent).toContain("[ИМЯ_1]");
    expect(sent).toContain("[СЧЁТ_1]");
    expect(sent).toContain("search_operations");
    expect(sent).toContain("8,47");
    // одно значение — одна метка во всём промпте (система, вопрос, аргумент и результат)
    expect(sent.match(/\[СЧЁТ_1\]/g)).toHaveLength(3);
    expect(sent).not.toContain("[СЧЁТ_2]");
  });

  it("PRIV-04: изображения проходят очистку метаданных, текст рядом маскируется", async () => {
    const sanitized: string[] = [];
    const inner = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      }),
    });
    await wrap(inner, sanitized).doGenerate({
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "Чек Анна" },
            {
              type: "file",
              mediaType: "image/jpeg",
              data: { type: "data", data: new Uint8Array([1]) },
            },
          ],
        },
      ],
    });
    expect(sanitized).toEqual(["image/jpeg"]);
    const parts = inner.doGenerateCalls[0]?.prompt[0]?.content as { filename?: string }[];
    expect(parts[1]?.filename).toBe("очищено");
  });
});

describe("PRIV-03: ответ с настоящими значениями", () => {
  it("текст и аргументы инструмента демаскируются (значение с кавычкой — экранировано в JSON)", async () => {
    const inner = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          { type: "text", text: "Это [ИМЯ_1], счёт [СЧЁТ_1]." },
          {
            type: "tool-call",
            toolCallId: "c2",
            toolName: "search_operations",
            input: JSON.stringify({ query: "[СЧЁТ_1]", note: "для [ИМЯ_1]" }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      }),
    });
    const result = await wrap(inner).doGenerate({ prompt: PROMPT });
    expect(result.content[0]).toEqual({ type: "text", text: `Это Анна, счёт ${IBAN}.` });
    expect(JSON.parse((result.content[1] as { input: string }).input)).toEqual({
      query: IBAN,
      note: "для Анна",
    });
  });

  it("поток: метка разрезана на куски — наружу идёт настоящее значение, обрывков меток нет", async () => {
    const chunks: LanguageModelV4StreamPart[] = [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Это [ИМ" },
      { type: "text-delta", id: "t", delta: "Я_1], счёт [СЧЁ" },
      { type: "text-delta", id: "t", delta: "Т_1] и конец [ИМ" },
      { type: "text-end", id: "t" },
      { type: "tool-input-start", id: "i", toolName: "search_operations" },
      { type: "tool-input-delta", id: "i", delta: '{"query":"[СЧЁ' },
      { type: "tool-input-delta", id: "i", delta: 'Т_1]"}' },
      { type: "tool-input-end", id: "i" },
      {
        type: "tool-call",
        toolCallId: "i",
        toolName: "search_operations",
        input: '{"query":"[СЧЁТ_1]"}',
      },
      finish,
    ];
    const inner = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }),
      }),
    });
    const { stream } = await wrap(inner).doStream({ prompt: PROMPT });
    const parts: LanguageModelV4StreamPart[] = [];
    for (const reader = stream.getReader(); ;) {
      const next = await reader.read();
      if (next.done) break;
      parts.push(next.value);
    }
    const text = parts.flatMap((p) => (p.type === "text-delta" ? [p.delta] : [])).join("");
    expect(text).toBe(`Это Анна, счёт ${IBAN} и конец [ИМ`);
    const args = parts.flatMap((p) => (p.type === "tool-input-delta" ? [p.delta] : [])).join("");
    expect(JSON.parse(args)).toEqual({ query: IBAN });
    const call = parts.find((p) => p.type === "tool-call") as { input: string };
    expect(JSON.parse(call.input)).toEqual({ query: IBAN });
    expect(parts.at(-1)).toEqual(finish);
    // порядок: сначала остаток блока, потом его конец
    const endIndex = parts.findIndex((p) => p.type === "text-end");
    expect(parts[endIndex - 1]).toMatchObject({ type: "text-delta", delta: "[ИМ" });
  });
});
