// Тестовый провайдер (ARCHITECTURE §8.1, §12): настоящий адаптер реестра провайдеров — локальный, бесплатный, без
// сети и ключей, с детерминированными ответами по сценарию. Это не заглушка в коде сценариев: шлюз зовёт его так же,
// как Groq или llama-server, а кассеты (make ai-record) пишутся с него. Сценарий чата: есть инструмент
// list_accounts и пользователь только что спросил — вызвать его; пришёл результат инструмента — ответить текстом
// по кускам с паузой paceMs (поток виден на сайте); иначе — короткий ответ. Ответ по схеме — «{}» (извлечение
// тестируют на MockLanguageModelV4), эмбеддинг — хэш текста, расшифровка речи — фиксированный текст.
import type {
  EmbeddingModelV4,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
  TranscriptionModelV4,
} from "@ai-sdk/provider";
import { createHash } from "node:crypto";
import type { ProviderAdapter } from "./provider-adapter.ts";

export const TEST_PROVIDER_ID = "test";

/** Ответ после результата list_accounts; текст пишет «модель» — сайт подписи берёт из словаря, а не отсюда. */
export const ACCOUNTS_ANSWER = "Вот ваши счета: остаток каждого — на карточке ниже.";
export const DEFAULT_ANSWER = "Я тестовая модель Кошта и отвечаю по сценарию.";
export const TRANSCRIPT = "тестовая расшифровка";
export const EMBEDDING_DIMENSIONS = 8;

type Plan =
  | { readonly kind: "tool"; readonly toolName: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "json" };

function plan(options: LanguageModelV4CallOptions): Plan {
  if (options.responseFormat?.type === "json") return { kind: "json" };
  const last = options.prompt.at(-1);
  if (last?.role === "tool") return { kind: "text", text: ACCOUNTS_ANSWER };
  const tools = (options.tools ?? []).flatMap((t) => (t.type === "function" ? [t.name] : []));
  if (
    last?.role === "user" &&
    options.toolChoice?.type !== "none" &&
    tools.includes("list_accounts")
  ) {
    return { kind: "tool", toolName: "list_accounts" };
  }
  return { kind: "text", text: DEFAULT_ANSWER };
}

/** Грубо: 4 символа на токен — детерминированно, для журнала расхода и лимитов. */
function usage(options: LanguageModelV4CallOptions, output: string): LanguageModelV4Usage {
  const input = Math.ceil(JSON.stringify(options.prompt).length / 4);
  const out = Math.ceil(output.length / 4);
  return {
    inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: out, text: out, reasoning: undefined },
  };
}

/** Куски текста по словам: так поток ответа виден по мере генерации. */
function pieces(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function scriptedModel(modelId: string, paceMs: number): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: TEST_PROVIDER_ID,
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const p = plan(options);
      const content: LanguageModelV4Content[] =
        p.kind === "tool"
          ? [{ type: "tool-call", toolCallId: "call-1", toolName: p.toolName, input: "{}" }]
          : [{ type: "text", text: p.kind === "json" ? "{}" : p.text }];
      return {
        content,
        finishReason: { unified: p.kind === "tool" ? "tool-calls" : "stop", raw: undefined },
        usage: usage(options, JSON.stringify(content)),
        warnings: [],
      };
    },
    async doStream(options) {
      const p = plan(options);
      const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
      let output: string;
      if (p.kind === "tool") {
        output = "{}";
        parts.push(
          { type: "tool-input-start", id: "call-1", toolName: p.toolName },
          { type: "tool-input-delta", id: "call-1", delta: "{}" },
          { type: "tool-input-end", id: "call-1" },
          { type: "tool-call", toolCallId: "call-1", toolName: p.toolName, input: "{}" },
        );
      } else {
        output = p.kind === "json" ? "{}" : p.text;
        parts.push({ type: "text-start", id: "text-1" });
        for (const delta of pieces(output)) parts.push({ type: "text-delta", id: "text-1", delta });
        parts.push({ type: "text-end", id: "text-1" });
      }
      parts.push({
        type: "finish",
        finishReason: { unified: p.kind === "tool" ? "tool-calls" : "stop", raw: undefined },
        usage: usage(options, output),
      });
      const signal = options.abortSignal;
      let index = 0;
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          async pull(controller) {
            const part = parts[index];
            index += 1;
            if (part === undefined) {
              controller.close();
              return;
            }
            // Пауза — только между кусками текста: так виден поток, а вызов инструмента не ждёт.
            if (part.type === "text-delta" && index > 3) await wait(paceMs, signal);
            controller.enqueue(part);
          },
        }),
      };
    },
  };
}

function hashEmbedding(text: string): number[] {
  const digest = createHash("sha256").update(text).digest();
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (digest[i] ?? 0) / 255);
}

function hashEmbedder(modelId: string): EmbeddingModelV4 {
  return {
    specificationVersion: "v4",
    provider: TEST_PROVIDER_ID,
    modelId,
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: true,
    async doEmbed({ values }) {
      return { embeddings: values.map(hashEmbedding), warnings: [] };
    },
  };
}

function fixedTranscriber(modelId: string): TranscriptionModelV4 {
  return {
    specificationVersion: "v4",
    provider: TEST_PROVIDER_ID,
    modelId,
    async doGenerate() {
      return {
        text: TRANSCRIPT,
        segments: [],
        language: "ru",
        durationInSeconds: undefined,
        warnings: [],
        response: { timestamp: new Date(0), modelId },
      };
    },
  };
}

/** paceMs — пауза между кусками текста ответа (на сайте виден поток); в тестах — 0. */
export function createTestProvider(options: { readonly paceMs?: number } = {}): ProviderAdapter {
  const paceMs = options.paceMs ?? 0;
  return {
    id: TEST_PROVIDER_ID,
    cloud: false,
    languageModel: (modelId) => scriptedModel(modelId, paceMs),
    embeddingModel: hashEmbedder,
    transcriptionModel: fixedTranscriber,
  };
}
