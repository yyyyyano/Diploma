// Реестр провайдеров (LLM-09): код, а не таблица — id → адаптер. Новый провайдер — один адаптер здесь (Groq, Z.ai,
// llama-server — T-023, T-024); модели провайдера — записи таблицы llm_models.
import type { ProviderAdapter } from "./provider-adapter.ts";

export type ProviderRegistry = ReadonlyMap<string, ProviderAdapter>;

export function createProviderRegistry(adapters: readonly ProviderAdapter[]): ProviderRegistry {
  const registry = new Map<string, ProviderAdapter>();
  for (const adapter of adapters) {
    if (registry.has(adapter.id)) throw new Error(`Провайдер ${adapter.id} объявлен дважды.`);
    registry.set(adapter.id, adapter);
  }
  return registry;
}
