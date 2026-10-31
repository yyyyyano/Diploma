// Процедуры legal-consult (contract.legalConsult.*): чек-листы документов — authed (домохозяйство из сессии) → сценарий. Чек-лист
// у каждого домохозяйства свой; шаблоны общие, галочки — свои (LEGAL-12).
import { authed } from "../../../platform/http/procedures.ts";
import type { Checklists } from "../application/checklists.ts";

export function legalConsultRouter(checklists: Checklists) {
  return {
    checklists: authed.legalConsult.checklists.handler(() => ({ items: checklists.list() })),
    checklist: authed.legalConsult.checklist.handler(({ input, context }) =>
      checklists.get(context.s, input),
    ),
    setChecked: authed.legalConsult.setChecked.handler(({ input, context }) =>
      checklists.setChecked(context.s, input),
    ),
  };
}
