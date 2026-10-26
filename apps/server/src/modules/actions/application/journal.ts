// Отменяемые действия (P5, AGT-05, TG-07): модуль-владелец пишет действие в журнал в своей транзакции (record) и
// отдаёт undoToken; «Отменить» на сайте, в боте и в чате — одна функция undo: в одной транзакции с обработчиком
// модуля-владельца (реестр undo), повторная отмена ничего не меняет, чужой или неизвестный токен — NOT_FOUND
// (неотличимы), а если после действия объект уже правили — CONFLICT: отмена не затирает более позднюю правку.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import {
  hasLaterAction,
  insertAction,
  lockAction,
  markUndone,
  type ActionChannel,
} from "../infrastructure/db/actions.repo.ts";

export interface RecordInput {
  /** Обработчик отмены модуля-владельца: `<модуль>.<действие>` из его `undo`. */
  readonly handler: string;
  /** Только id: обработчик перечитывает состояние сам. */
  readonly payload: unknown;
  /** Объект действия `<вид>:<id>` — по нему видно, правили ли его позже. */
  readonly subject: string;
  readonly channel: ActionChannel;
}

export type UndoStatus = "undone" | "already-undone";

export function makeJournal(d: Pick<Platform, "clock" | "log" | "actionHandlers">) {
  /** Записать действие в транзакции модуля-владельца; вернуть undoToken. */
  async function record(tx: ScopedDb, input: RecordInput): Promise<string> {
    if (!d.actionHandlers().undo.has(input.handler)) {
      throw new Error(`Нет обработчика отмены ${input.handler}: объявите его в undo модуля.`);
    }
    return insertAction(tx, input, d.clock.now());
  }

  /** «Отменить»: обработчик и отметка — одной транзакцией. */
  async function undo(s: ScopedDb, token: string): Promise<UndoStatus> {
    const status = await s.transaction(async (tx) => {
      const action = await lockAction(tx, token);
      if (action === undefined) throw new AppError("NOT_FOUND");
      if (action.status === "undone") return "already-undone" as const;
      if (await hasLaterAction(tx, action)) throw new AppError("CONFLICT");
      const handler = d.actionHandlers().undo.get(action.handler);
      if (handler === undefined) throw new Error(`Нет обработчика отмены ${action.handler}.`);
      await handler(tx, action.payload);
      await markUndone(tx, action.id, d.clock.now());
      return "undone" as const;
    });
    d.log.info({ actionId: token, status }, "actions.undo");
    return status;
  }

  return { record, undo };
}
