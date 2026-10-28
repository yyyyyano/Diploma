// Инструменты агента модуля profile (AGT-03 «профиль», PROF-04, ADR-0009): описание — по-английски и коротко, вход без
// владельца (данные — только ctx.s), выход — факты из @kosht/contract с оценкой на сегодня (PROF-06).
import { FactKey, FactValueInput, LocalDate, ProfileFact, UndoToken } from "@kosht/contract";
import { z } from "zod";
import type { Clock } from "@kosht/kernel";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Facts } from "../application/facts.ts";

export function profileTools(facts: Facts, clock: Clock) {
  return [
    defineTool({
      name: "read_profile_facts",
      toolset: "core",
      kind: "read",
      description:
        "Read what is known about the user (employment, children with ages today, benefits, housing queue, property). Assumed facts are estimates.",
      input: z.object({ keys: z.array(FactKey).max(13).optional() }),
      output: z.object({ onDate: LocalDate.schema, facts: z.array(ProfileFact) }),
      execute: async (ctx, input) => {
        if (input.keys === undefined) return facts.list(ctx.s);
        const onDate = clock.today();
        return { onDate, facts: await facts.getFacts(ctx.s, input.keys, onDate) };
      },
    }),
    defineTool({
      name: "upsert_profile_fact",
      toolset: "core",
      kind: "write",
      description:
        "Save or correct a fact the user stated in chat so it is not asked again. Returns the fact and an undo token.",
      input: z.object({ value: FactValueInput }),
      output: z.object({ fact: ProfileFact, undoToken: UndoToken }),
      execute: (ctx, input) =>
        facts.set(ctx.s, { value: input.value, source: "chat", channel: ctx.channel }),
    }),
  ];
}
