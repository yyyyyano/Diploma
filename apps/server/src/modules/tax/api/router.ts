// Процедуры tax (contract.tax.*): тонко — authed (домохозяйство из сессии) → сценарий.
import { authed } from "../../../platform/http/procedures.ts";
import type { Calculate } from "../application/calculate.ts";
import type { Found } from "../application/found.ts";

export function taxRouter(calculate: Calculate, found: Found) {
  return {
    found: authed.tax.found.handler(({ context }) => found.list(context.s)),
    markFoundShown: authed.tax.markFoundShown.handler(async ({ input, context }) => {
      await found.shown(context.s, input.ids);
      return { ok: true as const };
    }),
    setFoundStatus: authed.tax.setFoundStatus.handler(async ({ input, context }) => {
      const { found: row, undoToken } = await found.change(context.s, input.id, input.status);
      return { found: row, undoToken: undoToken as never };
    }),
    calculate: authed.tax.calculate.handler(({ input, context }) => calculate(context.s, input)),
  };
}
