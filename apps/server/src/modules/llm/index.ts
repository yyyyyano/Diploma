// Публичный API модуля llm (паспорт — CLAUDE.md): фабрика для корня композиции и шлюз для соседей.
export type { ChatModel, LlmGateway } from "./application/gateway.ts";
export { systemCaller, type Caller } from "./domain/caller.ts";
export { createLlmModule, type LlmAdminFacade, type LlmFacade, type LlmFacades } from "./module.ts";
