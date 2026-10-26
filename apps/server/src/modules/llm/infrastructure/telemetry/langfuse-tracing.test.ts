// ADR-0010, OBS-03, R46: вызов модели с интеграцией Langfuse даёт дерево спанов — операция с именем задачи, вызов
// модели внутри неё — с внутренним userId и id диалога (user.id, session.id). Экспорт — в память вместо сети: процессор
// Langfuse тот же, что в работе, без Langfuse и без интернета (NFR-11).
import { MockLanguageModelV4, type LanguageModelV4StreamPart } from "@kosht/testing";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { simulateReadableStream, streamText } from "ai";
import { describe, expect, it } from "vitest";
import { createTelemetry } from "../../../../platform/telemetry/telemetry.ts";
import { createLangfuseTracing, traceAttributes } from "./langfuse-tracing.ts";

const TARGET = { baseUrl: "http://127.0.0.1:9", publicKey: "pk-lf-test", secretKey: () => "sk" };

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

const answer: LanguageModelV4StreamPart[] = [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: "Готово." },
  { type: "text-end", id: "t" },
  { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
];

/** Экспортёр в память, который хранит спаны и после остановки (InMemorySpanExporter их стирает). */
function memoryExporter() {
  const spans: ReadableSpan[] = [];
  const exporter: SpanExporter = {
    export: (batch, done) => {
      spans.push(...batch);
      done({ code: 0 });
    },
    shutdown: async () => {},
  };
  return { exporter, spans };
}

describe("ADR-0010: трассы ответа модели в Langfuse", () => {
  it("операция invoke_agent chat и вызов модели внутри неё — с user.id и session.id", async () => {
    const { exporter, spans } = memoryExporter();
    const tracing = createLangfuseTracing(TARGET, { exporter });
    const options = createTelemetry(TARGET).options({
      functionId: "chat",
      userId: "0190f0a0-0000-7000-8000-00000000000a",
      sessionId: "0190f0a0-0000-7000-8000-00000000000c",
    });
    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({ stream: simulateReadableStream({ chunks: answer }) }),
      }),
      prompt: "Какие у меня счета?",
      telemetry: { ...options.telemetry, integrations: [tracing.integration] },
      runtimeContext: options.runtimeContext,
    });
    expect(await result.text).toBe("Готово.");
    await tracing.shutdown();

    const root = spans.find((span) => span.parentSpanContext === undefined);
    expect(root?.name).toBe("invoke_agent chat");
    expect(spans.length).toBeGreaterThan(1);
    for (const span of spans) {
      expect(span.spanContext().traceId).toBe(root?.spanContext().traceId);
      expect(span.attributes).toMatchObject({
        "user.id": "0190f0a0-0000-7000-8000-00000000000a",
        "session.id": "0190f0a0-0000-7000-8000-00000000000c",
      });
    }
  });

  it("задача без пользователя — без user.id и session.id", () => {
    expect(traceAttributes({})).toEqual({});
    expect(traceAttributes(undefined)).toEqual({});
    expect(traceAttributes({ userId: 1, sessionId: null })).toEqual({});
  });
});
