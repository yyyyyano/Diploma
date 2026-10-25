// Модуль chat (паспорт — CLAUDE.md): диалоги, сообщения (UIMessage.parts) и поток ответа агента (CHAT-01, CHAT-02).
// Запуски агента живут в реестре процесса api и не привязаны к соединению; при остановке процесса — доводятся в
// пределах срока или обрываются с сохранением ответа.
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
import { chatRouter } from "./api/router.ts";
import { createRunRegistry } from "./application/runs.ts";
import { makeHistory, makeSendMessage, makeStopRun } from "./application/send-message.ts";
import { chatUserData } from "./user-data.ts";

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

/**
 * Сколько ждать запуски при остановке процесса: меньше 10 с срока остановки (ADR-0015) — остаток нужен на
 * сохранение оборванных ответов, слушатели и пул.
 */
export const RUNS_GRACE_MS = 6_000;

export function createChatModule({ platform, facades }: ModuleDeps<ChatFacades, Platform>) {
  const runs = createRunRegistry(platform.log);
  return defineModule({
    id: "chat",
    router: chatRouter({
      history: makeHistory(),
      send: makeSendMessage({ agent: facades.agent, runs, platform }),
      stop: makeStopRun({ runs }),
    }),
    userData: chatUserData,
    stop: () => runs.shutdown(RUNS_GRACE_MS),
  });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type ChatFacade = ReturnType<typeof createChatModule>["facade"];
