// Процедуры calendar (contract.calendar.*): тонко — authed (домохозяйство из сессии) → сценарий.
import { authed } from "../../../platform/http/procedures.ts";
import type { Events } from "../application/events.ts";
import type { Read } from "../application/read.ts";

export function calendarRouter(read: Read, events: Events) {
  return {
    month: authed.calendar.month.handler(({ input, context }) => read.month(context.s, input)),
    upcoming: authed.calendar.upcoming.handler(({ context }) => read.upcoming(context.s)),
    create: authed.calendar.create.handler(async ({ input, context }) => {
      const { event, undoToken } = await events.create(context.s, input, "web");
      return { event, undoToken };
    }),
    update: authed.calendar.update.handler(async ({ input, context }) => {
      const { event, undoToken } = await events.update(context.s, input, "web");
      return { event, undoToken };
    }),
    requestDelete: authed.calendar.requestDelete.handler(async ({ input, context }) => ({
      decisionId: (await events.requestDelete(context.s, input.id)) as never,
    })),
  };
}
