// Embedder поверх шлюза (NFR-05): векторы — только локальной моделью цепочки `embed` (bge-m3); облако для них закрыто в
// buildChain. `caller` нужен шлюзу для журнала расхода и контекста, данные пользователя в векторы не маскируются:
// текст не покидает компьютер.
import type { Caller } from "../domain/caller.ts";
import type { LlmGateway } from "./gateway.ts";
import type { Embedder } from "./ports.ts";

/** Длина вектора bge-m3 (ADR-0007: одна схема таблиц под bge-m3 и Qwen3-Embedding). */
export const BGE_M3_DIMENSIONS = 1024;

export function gatewayEmbedder(llm: Pick<LlmGateway, "embed">, caller: Caller): Embedder {
  return {
    dimensions: BGE_M3_DIMENSIONS,
    embed: (texts) => llm.embed(caller, texts),
  };
}
