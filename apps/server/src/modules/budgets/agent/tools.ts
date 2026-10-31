// Инструменты агента модуля budgets (AGT-03 «лимиты и цели», AGT-05, AGT-07, ADR-0009): описание — по-английски и коротко,
// вход без владельца (данные — только ctx.s), выход — карточки из @kosht/contract. Прочитать — read; поставить лимит,
// создать цель, внести в копилку («отложи 200 на отпуск») — сразу с undoToken (write); удалить лимит или цель — только
// ожидающее решение (destructive), исполняет его «Да» человека. Числа агент берёт из результата, не считает.
import {
  BudgetGoal,
  BudgetLimit,
  BudgetsOverview,
  ContributeInput,
  CreateGoalInput,
  GoalId,
  LimitId,
  OverviewInput,
  SetLimitInput,
  UndoToken,
} from "@kosht/contract";
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Goals } from "../application/goals.ts";
import type { Limits } from "../application/limits.ts";
import type { Overview } from "../application/overview.ts";

export function budgetsTools(overview: Overview, limits: Limits, goals: Goals) {
  return {
    list: defineTool({
      name: "list_budgets",
      toolset: "planning",
      kind: "read",
      description:
        "List monthly category limits (spent, limit, percent, days left) and savings goals (saved, recommended monthly contribution, behind schedule). Amounts in BYN minor units.",
      input: OverviewInput,
      output: BudgetsOverview,
      execute: (ctx, input) => overview.view(ctx.s, input.month),
    }),
    setLimit: defineTool({
      name: "set_limit",
      toolset: "planning",
      kind: "write",
      description:
        "Set or change the monthly limit of an expense category (categoryKey like system:taxi). Returns the limit with an undo token.",
      input: SetLimitInput,
      output: z.object({ limit: BudgetLimit, undoToken: UndoToken }),
      execute: (ctx, input) => limits.set(ctx.s, input, ctx.channel),
    }),
    createGoal: defineTool({
      name: "create_goal",
      toolset: "planning",
      kind: "write",
      description:
        "Create a savings goal: piggy bank, or linked to a savings account or deposit. Returns it with an undo token.",
      input: CreateGoalInput,
      output: z.object({ goal: BudgetGoal, undoToken: UndoToken }),
      execute: (ctx, input) => goals.create(ctx.s, input, ctx.channel),
    }),
    contribute: defineTool({
      name: "contribute_to_goal",
      toolset: "planning",
      kind: "write",
      description:
        "Add money to a piggy-bank goal by id. Goals linked to an account take no contributions. Returns the goal with an undo token.",
      input: ContributeInput,
      output: z.object({ goal: BudgetGoal, undoToken: UndoToken }),
      execute: (ctx, input) => goals.contribute(ctx.s, input, ctx.channel),
    }),
    deleteLimit: defineTool({
      name: "delete_limit",
      toolset: "planning",
      kind: "destructive",
      description:
        "Ask the user to confirm deleting a category limit by id. Nothing is deleted until the user says yes.",
      input: z.object({ id: LimitId }),
      propose: async (ctx, input) => ({
        decisionId: await limits.requestDelete(ctx.s, input.id),
        count: 1,
      }),
    }),
    deleteGoal: defineTool({
      name: "delete_goal",
      toolset: "planning",
      kind: "destructive",
      description:
        "Ask the user to confirm deleting a savings goal by id. Nothing is deleted until the user says yes.",
      input: z.object({ id: GoalId }),
      propose: async (ctx, input) => ({
        decisionId: await goals.requestDelete(ctx.s, input.id),
        count: 1,
      }),
    }),
  };
}
