// Процедуры recurring (contract.recurring.*): тонко — authed (домохозяйство из сессии) → сценарий. Канал «Отменить» — сайт.
import { authed } from "../../../platform/http/procedures.ts";
import type { Decisions } from "../application/decisions.ts";
import { toDto } from "../application/mapping.ts";
import type { Read } from "../application/read.ts";

export function recurringRouter(read: Read, decisions: Decisions) {
  const changed = async (done: ReturnType<Decisions["confirm"]>) => {
    const { item, undoToken } = await done;
    return { item: toDto(item), undoToken: undoToken as never };
  };
  return {
    list: authed.recurring.list.handler(({ input, context }) => read.page(context.s, input)),
    confirm: authed.recurring.confirm.handler(({ input, context }) =>
      changed(decisions.confirm(context.s, input.id, "web")),
    ),
    exclude: authed.recurring.exclude.handler(({ input, context }) =>
      changed(decisions.exclude(context.s, input.id, "web")),
    ),
    end: authed.recurring.end.handler(({ input, context }) =>
      changed(decisions.end(context.s, input.id, "web")),
    ),
    resume: authed.recurring.resume.handler(({ input, context }) =>
      changed(decisions.resume(context.s, input.id, "web")),
    ),
    stillComing: authed.recurring.stillComing.handler(({ input, context }) =>
      changed(decisions.stillComing(context.s, input.id, "web")),
    ),
    edit: authed.recurring.edit.handler(({ input, context }) =>
      changed(decisions.edit(context.s, input, "web")),
    ),
    create: authed.recurring.create.handler(({ input, context }) =>
      changed(decisions.create(context.s, input, "web")),
    ),
    explain: authed.recurring.explain.handler(async ({ input, context }) => ({
      traceId: await read.explain(context.s, input.id),
    })),
    markers: authed.recurring.markers.handler(async ({ input, context }) => ({
      ids: await read.markers(context.s, input.ids),
    })),
  };
}
