// Публичный API модуля actions (паспорт — CLAUDE.md): фабрика для корня композиции, типы фасада и распознавание
// короткого «да / нет» для чата и бота.
export { parseShortAnswer, type ShortAnswer } from "./domain/short-answer.ts";
export { createActionsModule, type ActionsFacade, type ActionsFacades } from "./module.ts";
