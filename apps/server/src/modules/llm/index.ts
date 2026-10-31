// Публичный API модуля llm (паспорт — CLAUDE.md): фабрика для корня композиции и шлюз для соседей.
export type { ChatModel, LlmGateway } from "./application/gateway.ts";
export { systemCaller, type Caller } from "./domain/caller.ts";
export { createLlmModule, type LlmAdminFacade, type LlmFacade, type LlmFacades } from "./module.ts";
export type { Embedder } from "./application/ports.ts";
export { gatewayEmbedder } from "./application/embedder.ts";
export { localModelsReady } from "./events.ts";
// SEC-10: фильтр инструктивных фраз — им пользуются стражи агента (сообщения пользователя и данные страницы).
export { INJECTION_MARK, prepareDocument } from "./domain/injection.ts";
