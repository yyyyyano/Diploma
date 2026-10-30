// Процедуры budgets (contract.budgets.*): тонко — authed (домохозяйство из сессии) → сценарий. Канал «Отменить» — сайт.
import { authed } from "../../../platform/http/procedures.ts";
import type { Goals } from "../application/goals.ts";
import type { Limits } from "../application/limits.ts";
import type { Overview } from "../application/overview.ts";

export function budgetsRouter(overview: Overview, limits: Limits, goals: Goals) {
  return {
    overview: authed.budgets.overview.handler(({ input, context }) =>
      overview.view(context.s, input.month),
    ),
    setLimit: authed.budgets.setLimit.handler(async ({ input, context }) => {
      const { limit, undoToken } = await limits.set(context.s, input, "web");
      return { limit, undoToken: undoToken as never };
    }),
    requestDeleteLimit: authed.budgets.requestDeleteLimit.handler(async ({ input, context }) => ({
      decisionId: await limits.requestDelete(context.s, input.id),
    })),
    createGoal: authed.budgets.createGoal.handler(async ({ input, context }) => {
      const { goal, undoToken } = await goals.create(context.s, input, "web");
      return { goal, undoToken: undoToken as never };
    }),
    updateGoal: authed.budgets.updateGoal.handler(async ({ input, context }) => {
      const { goal, undoToken } = await goals.update(context.s, input, "web");
      return { goal, undoToken: undoToken as never };
    }),
    contribute: authed.budgets.contribute.handler(async ({ input, context }) => {
      const { goal, undoToken } = await goals.contribute(context.s, input, "web");
      return { goal, undoToken: undoToken as never };
    }),
    requestDeleteGoal: authed.budgets.requestDeleteGoal.handler(async ({ input, context }) => ({
      decisionId: await goals.requestDelete(context.s, input.id),
    })),
    previewGoal: authed.budgets.previewGoal.handler(({ input, context }) =>
      overview.preview(context.s, input),
    ),
  };
}
