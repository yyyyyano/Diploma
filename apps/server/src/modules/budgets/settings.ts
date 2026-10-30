// Допуск «отстаёт от графика» (BUD-07): подбирается на живых целях, поэтому настройка, а не константа.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** BUD-07: цель «отстаёт», если накоплено меньше планового на сегодня минус столько процентов планового. */
export const GOAL_BEHIND_TOLERANCE_PCT = defineSetting({
  key: "budgets.goal-behind-tolerance-pct",
  schema: z.int().min(0).max(50),
  default: 10,
});

export const BUDGETS_SETTINGS = [GOAL_BEHIND_TOLERANCE_PCT] as const;
