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
