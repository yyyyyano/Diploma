// Адаптер провайдера (LLM-09, NFR-04): новый провайдер — один адаптер, реализующий этот интерфейс; модели — записи
// реестра (llm_models). Реестр провайдеров — код: id → адаптер (providers.ts). Модели — спецификации AI SDK v4.
import type { EmbeddingModelV4, LanguageModelV4, TranscriptionModelV4 } from "@ai-sdk/provider";

export interface ProviderAdapter {
  /** Как в поле provider записи реестра: «test», «groq», «llama». */
  readonly id: string;
  languageModel(modelId: string): LanguageModelV4;
  embeddingModel?(modelId: string): EmbeddingModelV4;
  transcriptionModel?(modelId: string): TranscriptionModelV4;
}
