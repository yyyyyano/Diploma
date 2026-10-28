// Ожидающие решения «Да/Нет» (AGT-07, TXN-10, NOTIF-05, ARCHITECTURE §5): модуль-владелец создаёт решение с описанием
// изменений (ключ словаря и параметры — текст пишет сайт или бот); «Да» на сайте, кнопка в боте и короткое «да» в
// чате — одна функция answer: в одной транзакции с обработчиком «Да» модуля-владельца (реестр confirm); «Нет» — без
// обработчика; повторный ответ ничего не меняет и возвращает уже принятый; чужое решение — NOT_FOUND.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import {
  answerDecision,
  findDecision,
  insertDecision,
  type ActionChannel,
  type DecisionRow,
  type DecisionSummary,
} from "../infrastructure/db/actions.repo.ts";

export interface ProposeInput {
  /** Обработчик «Да» модуля-владельца: `<модуль>.<действие>` из его `confirm`. */
  readonly handler: string;
  readonly payload: unknown;
  /** Что изменится: ключ словаря (`decisions:…`) и параметры («Перенести 23 операции…»). */
  readonly summary: DecisionSummary;
}

export function makeDecisions(d: Pick<Platform, "clock" | "log" | "actionHandlers">) {
  async function propose(s: ScopedDb, input: ProposeInput): Promise<string> {
    if (!d.actionHandlers().confirm.has(input.handler)) {
      throw new Error(
        `Нет обработчика подтверждения ${input.handler}: объявите его в confirm модуля.`,
      );
    }
    return insertDecision(s, input, d.clock.now());
  }

  async function get(s: ScopedDb, id: string): Promise<DecisionRow> {
    const decision = await findDecision(s, id);
    if (decision === undefined) throw new AppError("NOT_FOUND");
    return decision;
  }

  /**
   * Ответ человека; итог — состояние решения после ответа (повтор — прежнее) и undoToken, если обработчик «Да» записал
   * своё действие в журнал отмены (удаление операций можно «Отменить» сразу после).
   */
  async function answer(
    s: ScopedDb,
    id: string,
    reply: "yes" | "no",
    channel: ActionChannel,
  ): Promise<{ status: "yes" | "no"; undoToken: string | null }> {
    const result = await s.transaction(async (tx) => {
      const decision = await findDecision(tx, id, true);
      if (decision === undefined) throw new AppError("NOT_FOUND");
      if (decision.status !== "pending") return { status: decision.status, undoToken: null };
      let undoToken: string | null = null;
      if (reply === "yes") {
        const handler = d.actionHandlers().confirm.get(decision.handler);
        if (handler === undefined)
          throw new Error(`Нет обработчика подтверждения ${decision.handler}.`);
        undoToken = (await handler(tx, decision.payload)) ?? null;
      }
      await answerDecision(tx, id, { status: reply, channel }, d.clock.now());
      return { status: reply, undoToken };
    });
    const { status } = result;
    d.log.info({ decisionId: id, status, reason: channel }, "actions.answered");
    return result;
  }

  return { propose, get, answer };
}
