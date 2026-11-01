// Процедуры calendar (contract.calendar.*): тонко — authed (домохозяйство из сессии) → сценарий.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { authed } from "../../../platform/http/procedures.ts";
import type { Properties } from "../application/properties.ts";
import type { Events } from "../application/events.ts";
import type { Read } from "../application/read.ts";

export function calendarRouter(
  read: Read,
  events: Events,
  properties: Properties,
  /** Пересчёт событий после ответа: налоги и техосмотр появляются сразу, не ждут события профиля. */
  resync: (s: ScopedDb) => Promise<number>,
) {
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
    propertyQuestion: authed.calendar.propertyQuestion.handler(async ({ context }) => ({
      question: await properties.question(context.s),
    })),
    answerProperty: authed.calendar.answerProperty.handler(async ({ input, context }) => {
      const { undoToken } = await properties.answer(context.s, input);
      await resync(context.s);
      return { undoToken: undoToken as never };
    }),
    requestDelete: authed.calendar.requestDelete.handler(async ({ input, context }) => ({
      decisionId: (await events.requestDelete(context.s, input.id)) as never,
    })),
  };
}
