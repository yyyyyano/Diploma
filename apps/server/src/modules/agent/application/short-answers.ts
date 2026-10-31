// Короткие ответы человека до запуска агента (AGT-06, AGT-07): «да»/«нет» на ожидающее решение и выбор варианта вопроса
// `ask_user`. Распознаёт код, а не модель: «да» не должно зависеть от настроения модели, а ответ на дозапрос — от
// того, вспомнит ли она записать факт. Решение берётся из результата destructive-инструмента в последнем ответе
// ассистента этого диалога; нет ожидающего решения — «да» уходит агенту обычным текстом.
import type { ActionResultData } from "@kosht/contract";
import type { UIMessage } from "ai";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { ToolChannel } from "../../../platform/tools/define-tool.ts";
import { parseShortAnswer, type ActionsFacade } from "../../actions/index.ts";
import type { ProfileFacade } from "../../profile/index.ts";
import { ASK_USER, AskInput, optionToFact, type AskUserInput } from "./ask-user.ts";
import { pendingOf, toolNameOf } from "./history.ts";
import { matchOption } from "./short-reply.ts";

export type ShortOutcome =
  /** «Да»/«Нет» исполнено кодом: часть `data-action-result` и короткий текст — без модели. */
  | { readonly kind: "decision"; readonly data: ActionResultData }
  /** «Да» не удалось исполнить (данные изменились): честное сообщение, решение закрыто или осталось. */
  | { readonly kind: "failed" }
  /** Ответ совпал с вариантом дозапроса: факт записан, агент продолжает с пометкой в контексте. */
  | { readonly kind: "fact"; readonly factKey: string };

export interface ShortDeps {
  readonly actions: Pick<ActionsFacade, "decision" | "answer">;
  readonly profile: Pick<ProfileFacade, "recordAnswer">;
  readonly log: Logger;
}

/** Последний ответ ассистента перед вопросом пользователя. */
function lastAssistant(messages: readonly UIMessage[]): UIMessage | undefined {
  return messages
    .slice(0, -1)
    .findLast((message) => message.role === "assistant" && message.parts.length > 0);
}

/** Id единственного ожидающего решения в последнем ответе; два и больше — неоднозначно, «да» идёт агенту. */
export function pendingDecisionId(messages: readonly UIMessage[]): string | undefined {
  const pending = (lastAssistant(messages)?.parts ?? [])
    .map((part) => (toolNameOf(part) === undefined ? undefined : pendingOf(part)))
    .filter((p): p is { decisionId: string; count: number } => p !== undefined);
  return pending.length === 1 ? pending[0]?.decisionId : undefined;
}

/** Незакрытый вопрос `ask_user` в последнем ответе (вызов без результата). */
export function openQuestion(messages: readonly UIMessage[]): AskUserInput | undefined {
  for (const part of lastAssistant(messages)?.parts ?? []) {
    if (toolNameOf(part) !== ASK_USER) continue;
    if ((part as { state?: unknown }).state === "output-available") continue;
    const input = AskInput.safeParse((part as { input?: unknown }).input);
    if (input.success) return input.data;
  }
  return undefined;
}

export async function answerShort(
  d: ShortDeps,
  s: ScopedDb,
  input: { readonly messages: readonly UIMessage[]; readonly channel: ToolChannel },
): Promise<ShortOutcome | undefined> {
  const question = input.messages.at(-1);
  if (question === undefined || question.role !== "user") return undefined;
  const text = question.parts.map((part) => (part.type === "text" ? part.text : "")).join(" ");
  const reply = parseShortAnswer(text);
  const decisionId = reply === undefined ? undefined : pendingDecisionId(input.messages);
  if (reply !== undefined && decisionId !== undefined) {
    try {
      const decision = await d.actions.decision(s, decisionId);
      if (decision.status === "pending") {
        const result = await d.actions.answer(s, decisionId, reply, input.channel);
        d.log.info({ decisionId, status: result.status }, "agent.short-answer");
        return {
          kind: "decision",
          data: { decisionId, status: result.status, undoToken: result.undoToken },
        };
      }
    } catch (error) {
      // Решения нет (NOT_FOUND) — «да» это обычный текст; прочее — «не получилось»: обработчик «Да» отказал.
      if (!(error instanceof AppError) || error.code !== "NOT_FOUND") {
        d.log.warn({ err: error, code: "SHORT_ANSWER_FAILED" }, "agent.short-answer-failed");
        return { kind: "failed" };
      }
    }
  }
  const asked = openQuestion(input.messages);
  const option = asked?.options === undefined ? undefined : matchOption(text, asked.options);
  const value =
    asked === undefined || option === undefined
      ? undefined
      : optionToFact(asked.factKey, option.value);
  if (asked !== undefined && value !== undefined) {
    try {
      await d.profile.recordAnswer(s, { value, messageId: question.id, channel: input.channel });
      d.log.info({ reason: asked.factKey }, "agent.answer-recorded");
      return { kind: "fact", factKey: asked.factKey };
    } catch (error) {
      d.log.warn({ err: error, code: "ANSWER_RECORD_FAILED" }, "agent.answer-record-failed");
    }
  }
  return undefined;
}
