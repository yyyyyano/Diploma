// Инструменты агента модуля calendar (AGT-03 «планирование», CAL-06, AGT-05, ADR-0009): описание — по-английски и коротко, вход
// без владельца (данные — только ctx.s), выход — из @kosht/contract. Показать события — read; создать — write: сразу, с undoToken
// (удаление — только решением «Да/Нет» на сайте). День модель берёт из «сегодня» в сообщении и называет `YYYY-MM-DD`; суммы — копейки BYN.
import { CalendarEntry, CalendarRange, CreateEventInput, UndoToken } from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Events } from "../application/events.ts";
import type { Read } from "../application/read.ts";

export function calendarTools(read: Read, events: Events) {
  return {
    listEvents: defineTool({
      name: "list_events",
      toolset: "planning",
      kind: "read",
      description:
        "List calendar events in a period (default: next 30 days): taxes, warranties, insurance, own reminders, expected recurring payments and income. Returns entries with dates, amounts and totals. Amounts in BYN minor units.",
      input: z.strictObject({
        from: LocalDate.schema.optional(),
        to: LocalDate.schema.optional(),
      }),
      output: CalendarRange,
      execute: (ctx, input) => read.range(ctx.s, input),
    }),
    createEvent: defineTool({
      name: "create_event",
      toolset: "planning",
      kind: "write",
      description:
        "Create a calendar event or reminder on a date (YYYY-MM-DD, today or later), e.g. 'remind me on 1 December to pay for kindergarten'. Optional amount in BYN minor units and remindDays (0, 1, 7, 30). Returns the event with an undo token.",
      input: CreateEventInput,
      output: z.strictObject({ event: CalendarEntry, undoToken: UndoToken }),
      execute: async (ctx, input) => {
        const { event, undoToken } = await events.create(
          ctx.s,
          CreateEventInput.parse(input),
          ctx.channel,
          "chat",
        );
        return { event, undoToken: UndoToken.parse(undoToken) };
      },
    }),
  };
}
