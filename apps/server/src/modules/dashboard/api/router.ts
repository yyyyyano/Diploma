// Процедуры dashboard (contract.dashboard.*): тонко — authed (домохозяйство из сессии) → сценарий.
import { authed } from "../../../platform/http/procedures.ts";
import type { Overview } from "../application/overview.ts";

export function dashboardRouter(overview: Overview) {
  return {
    overview: authed.dashboard.overview.handler(({ input, context }) =>
      overview.view(context.s, input),
    ),
  };
}
