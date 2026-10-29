// КП PRIV: «в Langfuse текст замаскирован» — канарейка по атрибутам спанов. Вызов настоящей цепочки с обёрткой
// маскирования, настоящий процессор Langfuse с маской, экспорт — в память: ни имя, ни счёт, ни карта, ни телефон, ни
// email не должны попасть ни в один атрибут ни одного спана. Данные синтетические (NFR-18).
import { MockLanguageModelV4, testScope } from "@kosht/testing";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { createTelemetry } from "../../../../platform/telemetry/telemetry.ts";
import { createLangfuseTracing } from "../../infrastructure/telemetry/langfuse-tracing.ts";
import { maskedModel } from "./masked-model.ts";
import { createMasker } from "./masker.ts";
import { createRedactions } from "./redactions.ts";
import { createTraceMask } from "./trace-mask.ts";

const TARGET = { baseUrl: "http://127.0.0.1:9", publicKey: "pk-lf-test", secretKey: () => "sk" };
const scope = testScope();
const SECRETS = [
  "Анна",
  "BY20 AKBB 3012 0000 0418 8000 0000",
  "4111 1111 1111 1111",
  "+375 (29) 123-45-67",
  "anna.sidorova@example.by",
];
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

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

describe("КП PRIV: в Langfuse текст замаскирован", () => {
  it("атрибуты всех спанов вызова не содержат ни одного личного значения — ни из запроса, ни из ответа", async () => {
    const redactions = createRedactions(() => Date.now());
    const masker = createMasker({ names: { names: async () => ["Анна"] }, redactions });
    const { exporter, spans } = memoryExporter();
    const tracing = createLangfuseTracing(TARGET, { exporter, mask: createTraceMask(redactions) });
    const options = createTelemetry(TARGET).options({
      functionId: "chat",
      userId: "u",
      sessionId: "s",
    });
    const model = maskedModel(
      new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: "text", text: "Это [ИМЯ_1], карта [КАРТА_1], почта [EMAIL_1]." }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        }),
      }),
      { masker, scope, sanitizeFile: async (part) => part },
    );
    const result = await generateText({
      model,
      prompt: `Анна, счёт ${SECRETS[1]}, карта ${SECRETS[2]}, тел. ${SECRETS[3]}, ${SECRETS[4]}`,
      telemetry: { ...options.telemetry, integrations: [tracing.integration] },
      runtimeContext: options.runtimeContext,
    });
    // вызывающий получил настоящие значения…
    expect(result.text).toContain("Анна");
    expect(result.text).toContain(SECRETS[2]);
    await tracing.shutdown();

    // …а в трассах их нет
    expect(spans.length).toBeGreaterThan(1);
    const everything = JSON.stringify(spans.map((span) => span.attributes));
    for (const secret of SECRETS) expect(everything).not.toContain(secret);
    expect(everything).toMatch(/\[ИМЯ_1\]|\[СЧЁТ|\[КАРТА/);
  });

  it("значение мимо маскировщика (результат инструмента, ошибка) ловится правилами: счёт, карта, телефон, email", () => {
    const mask = createTraceMask(createRedactions(() => 0));
    const masked = mask({
      data: {
        error: `не вышло перевести ${SECRETS[1]} с ${SECRETS[2]}`,
        contact: [SECRETS[3], SECRETS[4]],
        total: 8.47,
        ok: true,
      },
    });
    expect(masked).toEqual({
      error: "не вышло перевести [СЧЁТ] с [КАРТА]",
      contact: ["[ТЕЛЕФОН]", "[EMAIL]"],
      total: 8.47,
      ok: true,
    });
  });

  it("суммы, даты и названия магазинов в трассах остаются", () => {
    const mask = createTraceMask(createRedactions(() => 0));
    expect(mask({ data: "Евроопт 21.10.2026 итого 1 234,56 BYN" })).toBe(
      "Евроопт 21.10.2026 итого 1 234,56 BYN",
    );
  });
});
