// Публичный API модуля legal-consult (паспорт — CLAUDE.md): фабрика для корня композиции и типы для соседей.
export {
  createLegalConsultModule,
  type LegalConsultFacade,
  type LegalConsultFacades,
} from "./module.ts";
export type {
  FinalizeInput,
  LawAnswer,
  LawCitation,
  LawNotice,
  LawPart,
} from "./application/finalize-answer.ts";
// Темы вопросов (LAW-15): агент называет тему, когда в базе нормы нет; список ведёт legal-base.
export { TOPICS, type Topic } from "../legal-base/index.ts";
