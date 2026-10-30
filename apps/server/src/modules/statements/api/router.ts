// Процедуры statements (contract.statements.*): тонко — authed (домохозяйство из сессии) → сценарий. Канал «Отменить» — сайт.
import { StatementImportId } from "@kosht/contract";
import { authed } from "../../../platform/http/procedures.ts";
import type { Settings } from "../../../platform/settings/settings.ts";
import type { Imports } from "../application/imports.ts";
import { toDetail, toSummary } from "../application/mapping.ts";
import { STATEMENTS_PREVIEW_ROWS } from "../settings.ts";
import { FileId } from "@kosht/kernel";

export function statementsRouter(imports: Imports, settings: Pick<Settings, "get">) {
  return {
    start: authed.statements.start.handler(async ({ input, context }) => {
      const { id } = await imports.start(context.s, FileId.parse(input.fileId));
      return { id: StatementImportId.parse(id) };
    }),
    list: authed.statements.list.handler(async ({ context }) => ({
      items: (await imports.list(context.s)).map(toSummary),
    })),
    get: authed.statements.get.handler(async ({ input, context }) =>
      toDetail(await imports.get(context.s, input.id), await settings.get(STATEMENTS_PREVIEW_ROWS)),
    ),
    confirm: authed.statements.confirm.handler(async ({ input, context }) => {
      const done = await imports.confirm(context.s, input.id);
      return {
        imported: done.imported,
        duplicates: done.duplicates,
        undoToken: done.undoToken,
        decisionId: done.decisionId ?? null,
      };
    }),
    fixColumns: authed.statements.fixColumns.handler(async ({ input, context }) => {
      await imports.fixColumns(context.s, input.id, input.columns);
      return { id: input.id };
    }),
    cancel: authed.statements.cancel.handler(async ({ input, context }) => {
      await imports.cancel(context.s, input.id);
      return { id: input.id };
    }),
    rollbackInfo: authed.statements.rollbackInfo.handler(({ input, context }) =>
      imports.rollbackInfo(context.s, input.id),
    ),
    rollback: authed.statements.rollback.handler(({ input, context }) =>
      imports.requestRollback(context.s, input.id),
    ),
  };
}
