// Адаптеры на @ai-sdk/openai-compatible (ADR-0009): Z.ai (облако) и llama-server (локально, ADR-0011).
// Z.ai не следует `response_format: json_schema` (отвечает текстом, проверено 2026-10-29), а `json_object` схему не
// знает, — для него схема ответа переносится в системное сообщение (schemaInPrompt), проверку по схеме всё равно
// делает AI SDK (LLM-04). llama-server схему понимает (грамматика) — отдельной подсказки не нужно.
import type { EmbeddingModelV4, LanguageModelV4 } from "@ai-sdk/provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, wrapLanguageModel } from "ai";
import type { ProviderAdapter } from "./provider-adapter.ts";
import {
  fetchModelIds,
  PLACEHOLDER_BASE_URL,
  remoteFetch,
  type RemoteSource,
} from "./remote-fetch.ts";

export const ZAI_PROVIDER_ID = "zai";
export const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";
export const LLAMA_PROVIDER_ID = "llama";

/** Схема ответа — в системное сообщение, режим ответа — просто JSON: для провайдеров без `json_schema`. */
function schemaInPrompt(model: LanguageModelV4): LanguageModelV4 {
  return wrapLanguageModel({
    model,
    middleware: {
      transformParams: async ({ params }) => {
        const format = params.responseFormat;
        if (format?.type !== "json" || format.schema === undefined) return params;
        const instruction =
          "Reply with a single JSON object that matches this JSON Schema and nothing else:\n" +
          JSON.stringify(format.schema);
        return {
          ...params,
          responseFormat: { type: "json" },
          prompt: [{ role: "system", content: instruction }, ...params.prompt],
        };
      },
    },
  });
}

function create(options: {
  readonly id: string;
  readonly cloud: boolean;
  readonly source: RemoteSource;
  readonly structuredOutputs: boolean;
  /** `GET /models` неполон: модель вне списка проверяется пробой на один токен. */
  readonly partialModelList?: boolean;
  readonly fetch?: typeof fetch;
}): ProviderAdapter {
  const provider = createOpenAICompatible({
    name: options.id,
    baseURL: PLACEHOLDER_BASE_URL,
    fetch: remoteFetch(options.source, options.fetch),
    includeUsage: true,
    supportsStructuredOutputs: options.structuredOutputs,
  });
  const adapter: ProviderAdapter = {
    id: options.id,
    cloud: options.cloud,
    languageModel: (modelId) => {
      const model = provider.languageModel(modelId);
      return options.structuredOutputs ? model : schemaInPrompt(model);
    },
    embeddingModel: (modelId): EmbeddingModelV4 => provider.embeddingModel(modelId),
    isConfigured: async () =>
      options.source.key === undefined ? true : (await options.source.key()) !== undefined,
    listModels: () => fetchModelIds(options.source, options.fetch),
    ...(options.partialModelList === true
      ? {
          probe: async (modelId: string) => {
            await generateText({
              model: adapter.languageModel(modelId),
              prompt: "ping",
              maxOutputTokens: 1,
              maxRetries: 0,
            });
          },
        }
      : {}),
  };
  return adapter;
}

export function createZaiAdapter(d: {
  readonly key: () => Promise<string | undefined>;
  readonly fetch?: typeof fetch;
}): ProviderAdapter {
  return create({
    id: ZAI_PROVIDER_ID,
    cloud: true,
    source: { baseUrl: async () => ZAI_BASE_URL, key: d.key },
    structuredOutputs: false,
    // Проверено 2026-10-29: glm-4.7-flash отвечает, но в GET /models Z.ai его нет.
    partialModelList: true,
    ...(d.fetch === undefined ? {} : { fetch: d.fetch }),
  });
}

/** llama-server на этом компьютере: адрес — настройка, ключа нет (порт слушает только 127.0.0.1, ADR-0015). */
export function createLlamaAdapter(d: {
  readonly baseUrl: () => Promise<string>;
  readonly fetch?: typeof fetch;
}): ProviderAdapter {
  return create({
    id: LLAMA_PROVIDER_ID,
    cloud: false,
    source: { baseUrl: d.baseUrl },
    structuredOutputs: true,
    ...(d.fetch === undefined ? {} : { fetch: d.fetch }),
  });
}
