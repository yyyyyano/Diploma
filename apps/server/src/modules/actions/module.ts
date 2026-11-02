// Модуль actions (паспорт — CLAUDE.md): журнал отменяемых действий и ожидающие решения «Да/Нет» (P5, AGT-05, AGT-07,
// ARCHITECTURE §5). Обработчики модулей-владельцев — из реестров undo/confirm корня композиции (Platform.actionHandlers,
// позднее связывание); сайт — процедуры, бот и чат — фасад; короткое «да/нет» текстом — parseShortAnswer.
import {
  defineModule,
  type ModuleDeps,
  type NoFacades,
  type Platform,
} from "../../platform/module/define-module.ts";
import { actionsRouter } from "./api/router.ts";
import { makeDecisions } from "./application/decisions.ts";
import { makeJournal } from "./application/journal.ts";
import { actionsUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type ActionsFacades = NoFacades;

export function createActionsModule({ platform }: ModuleDeps<ActionsFacades, Platform>) {
  const journal = makeJournal(platform);
  const decisions = makeDecisions(platform);
  return defineModule({
    id: "actions",
    facade: {
      record: journal.record,
      undo: journal.undo,
      // TG-07: `/undo` — последнее отменяемое действие канала за окно времени.
      lastUndoable: journal.lastUndoable,
      propose: decisions.propose,
      answer: decisions.answer,
      decision: decisions.get,
    },
    router: actionsRouter({ journal, decisions }),
    userData: actionsUserData,
  });
}

/** Что модуль даёт соседям: record/undo — журнал отмены, propose/answer/decision — ожидающие решения. */
export type ActionsFacade = ReturnType<typeof createActionsModule>["facade"];
