// Модуль chat (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { AgentFacade } from "../agent/index.ts";
import type { FilesFacade } from "../files/index.ts";
import type { ReceiptsFacade } from "../receipts/index.ts";
import type { StatementsFacade } from "../statements/index.ts";
import type { VoiceFacade } from "../voice/index.ts";
import type { LegalBaseFacade } from "../legal-base/index.ts";
import type { LegalConsultFacade } from "../legal-consult/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface ChatFacades {
  readonly agent: AgentFacade;
  readonly files: FilesFacade;
  readonly receipts: ReceiptsFacade;
  readonly statements: StatementsFacade;
  readonly voice: VoiceFacade;
  readonly legalBase: LegalBaseFacade;
  readonly legalConsult: LegalConsultFacade;
}

export function createChatModule(_deps: ModuleDeps<ChatFacades, Platform>) {
  return defineModule({ id: "chat" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type ChatFacade = ReturnType<typeof createChatModule>["facade"];
