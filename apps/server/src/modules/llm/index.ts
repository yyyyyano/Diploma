// Публичный API модуля llm (паспорт — CLAUDE.md): фабрика для корня композиции и шлюз для соседей.
export type { ChatModel, LlmGateway } from "./application/gateway.ts";
export { systemCaller, type Caller } from "./domain/caller.ts";
export {
  createLlmModule,
  type LlmAdminFacade,
  type LlmChoiceFacade,
  type LlmFacade,
  type LlmFacades,
} from "./module.ts";
export type { Embedder, Transcriber } from "./application/ports.ts";
export { gatewayTranscriber } from "./application/transcriber.ts";
export { gatewayEmbedder } from "./application/embedder.ts";
export { localModelsReady } from "./events.ts";
// SEC-10: фильтр инструктивных фраз — им пользуются стражи агента (сообщения пользователя и данные страницы).
export { INJECTION_MARK, prepareDocument } from "./domain/injection.ts";
// AGT-04, WEEK-02, P1: проверка чисел текста модели — реестр разрешённых чисел и разбиение на предложения. Живёт в llm, чтобы ею
// пользовались и агент (ярус 4), и итоги недели (ярус 3): ярус 3 от агента зависеть не может.
export { extractNumbers, fromNumber, NumberLedger, type Canonical } from "./domain/numbers.ts";
export { createSentenceSplitter, type SentenceSplitter } from "./domain/sentences.ts";
