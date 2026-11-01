// Процедуры tax (contract.tax.*): тонко — authed (домохозяйство из сессии) → сценарий.
import { authed } from "../../../platform/http/procedures.ts";
import type { Calculate } from "../application/calculate.ts";

export function taxRouter(calculate: Calculate) {
  return {
    calculate: authed.tax.calculate.handler(({ input, context }) => calculate(context.s, input)),
  };
}
