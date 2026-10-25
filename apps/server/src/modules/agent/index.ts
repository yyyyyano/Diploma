// Публичный API модуля agent (паспорт — CLAUDE.md): фабрика для корня композиции, типы и префикс для проверки размера.
export { agentPrefix } from "./application/prefix.ts";
export { createAgentModule, type AgentFacade, type AgentFacades } from "./module.ts";
