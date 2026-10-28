// Процедуры actions (contract.actions.*): все authed — «Отменить» и «Да/Нет» сайта; бот и чат зовут те же сценарии
// фасадом. Канал ответа сайта — web.
import type { Decision } from "@kosht/contract";
import { authed } from "../../../platform/http/procedures.ts";
import type { makeDecisions } from "../application/decisions.ts";
import type { makeJournal } from "../application/journal.ts";

export interface ActionsUseCases {
  readonly journal: ReturnType<typeof makeJournal>;
  readonly decisions: ReturnType<typeof makeDecisions>;
}

export function actionsRouter(uc: ActionsUseCases) {
  return {
    undo: authed.actions.undo.handler(async ({ input, context }) => ({
      status: await uc.journal.undo(context.s, input.token),
    })),
    decision: authed.actions.decision.handler(async ({ input, context }): Promise<Decision> => {
      const decision = await uc.decisions.get(context.s, input.id);
      return {
        id: decision.id,
        status: decision.status,
        summary: decision.summary,
        createdAt: decision.createdAt.toISOString(),
      };
    }),
    answer: authed.actions.answer.handler(({ input, context }) =>
      uc.decisions.answer(context.s, input.id, input.answer, "web"),
    ),
  };
}
