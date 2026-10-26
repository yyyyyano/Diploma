// Процедуры explain (contract.explain.*): authed — объяснение числа по traceId (панель «Откуда эта цифра?»).
import type { Explanation } from "@kosht/contract";
import { authed } from "../../../platform/http/procedures.ts";
import type { StoredExplanation } from "../domain/explanation.ts";
import type { Explanations } from "../application/explanations.ts";

/** Объяснение на проводе: период — или null, момент — ISO UTC. */
export function toExplanationDto(found: StoredExplanation): Explanation {
  return {
    id: found.id as Explanation["id"],
    trace: found.trace,
    period: found.period ?? null,
    createdAt: found.createdAt.toISOString(),
  };
}

export function explainRouter(uc: Pick<Explanations, "get">) {
  return {
    get: authed.explain.get.handler(async ({ input, context }) =>
      toExplanationDto(await uc.get(context.s, input.id)),
    ),
  };
}
