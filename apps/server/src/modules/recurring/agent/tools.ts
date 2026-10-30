// Инструменты агента модуля recurring (AGT-03 «планирование», ADR-0009): оба — чтение; описание — по-английски и коротко,
// вход без владельца, выход — компактный (только числа расчёта, без операций). Суммы агент берёт из результата, не считает.
import { RecurringItem } from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import { toDto } from "../application/mapping.ts";
import { addDays } from "../domain/dates.ts";
import type { Read } from "../application/read.ts";

const MAX_ITEMS = 50;
const MAX_DAYS = 90;

const Upcoming = z.object({
  id: z.uuid(),
  name: z.string(),
  section: z.enum(["income", "mandatory", "subscriptions", "other"]),
  on: LocalDate.schema,
  amount: z.object({ minor: z.int(), currency: z.string() }),
});

export function recurringTools(read: Read, today: () => LocalDate) {
  return {
    list: defineTool({
      name: "list_recurring",
      toolset: "planning",
      kind: "read",
      description:
        "List the user's recurring payments (income, mandatory, subscriptions) with period, average amount in BYN minor units, next expected date and state.",
      input: z.object({
        section: z.enum(["income", "mandatory", "subscriptions", "other"]).optional(),
      }),
      output: z.object({ items: z.array(RecurringItem).max(MAX_ITEMS) }),
      execute: async (ctx, input) => {
        const entries = await read.list(ctx.s, {
          ...(input.section === undefined ? {} : { sections: [input.section] }),
          onDate: today(),
        });
        return { items: entries.slice(0, MAX_ITEMS).map(toDto) };
      },
    }),
    upcoming: defineTool({
      name: "upcoming_payments",
      toolset: "planning",
      kind: "read",
      description:
        "Recurring payments expected in the next N days (default 30, max 90): date, name and average amount in BYN minor units.",
      input: z.object({ days: z.int().min(1).max(MAX_DAYS).default(30) }),
      output: z.object({ items: z.array(Upcoming).max(MAX_ITEMS * 4) }),
      execute: async (ctx, input) => {
        const from = today();
        const to = addDays(from, input.days);
        const found = await read.upcoming(ctx.s, { from, to });
        return {
          items: found.slice(0, MAX_ITEMS * 4).map((p) => ({
            id: p.id,
            name: p.name,
            section: p.section,
            on: p.on,
            amount: p.amount.value,
          })),
        };
      },
    }),
  };
}
