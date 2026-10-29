// Адаптер Groq (ADR-0009, LLM-02): облачные модели чата, изображений и речи по @ai-sdk/groq. Ключ — секрет
// `llm.groq-api-key` (админка или GROQ_API_KEY), читается в момент вызова (remote-fetch.ts).
import { createGroq } from "@ai-sdk/groq";
import type { ProviderAdapter } from "./provider-adapter.ts";
import {
  fetchModelIds,
  PLACEHOLDER_BASE_URL,
  remoteFetch,
  type RemoteSource,
} from "./remote-fetch.ts";

export const GROQ_PROVIDER_ID = "groq";
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export function createGroqAdapter(d: {
  readonly key: () => Promise<string | undefined>;
  readonly fetch?: typeof fetch;
}): ProviderAdapter {
  const source: RemoteSource = { baseUrl: async () => GROQ_BASE_URL, key: d.key };
  const provider = createGroq({
    baseURL: PLACEHOLDER_BASE_URL,
    // Значение подменяет remoteFetch; пакет требует непустую строку.
    apiKey: "set-per-request",
    fetch: remoteFetch(source, d.fetch),
  });
  return {
    id: GROQ_PROVIDER_ID,
    languageModel: (modelId) => provider.languageModel(modelId),
    transcriptionModel: (modelId) => provider.transcription(modelId),
    isConfigured: async () => (await d.key()) !== undefined,
    listModels: () => fetchModelIds(source, d.fetch),
  };
}
