// Процедуры afford (contract.afford.*): тонко — authed (домохозяйство из сессии) → сценарий. Ползунок и быстрые суммы на сайте
// вызывают `scenarios` заново: числа считает сервер (P1).
import { authed } from "../../../platform/http/procedures.ts";
import type { SafeLoan } from "../application/safe-loan.ts";
import type { Scenarios } from "../application/scenarios.ts";

export function affordRouter(scenarios: Scenarios, safeLoan: SafeLoan) {
  return {
    scenarios: authed.afford.scenarios.handler(({ input, context }) => scenarios(context.s, input)),
    safeLoan: authed.afford.safeLoan.handler(({ input, context }) => safeLoan(context.s, input)),
  };
}
