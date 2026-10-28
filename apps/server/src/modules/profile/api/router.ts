// Процедуры profile (contract.profile.*): тонко — authed (домохозяйство из сессии) → сценарий. Канал «Отменить» — сайт.
import { authed } from "../../../platform/http/procedures.ts";
import type { Facts } from "../application/facts.ts";

export function profileRouter(facts: Facts) {
  return {
    facts: authed.profile.facts.handler(({ context }) => facts.list(context.s)),
    onboarding: authed.profile.onboarding.handler(({ context }) => facts.onboarding(context.s)),
    completeOnboarding: authed.profile.completeOnboarding.handler(({ input, context }) =>
      facts.completeOnboarding(context.s, input.answers),
    ),
    setFact: authed.profile.setFact.handler(({ input, context }) =>
      facts.set(context.s, {
        ...(input.id === undefined ? {} : { id: input.id }),
        value: input.value,
        source: "user",
        channel: "web",
      }),
    ),
    confirmFact: authed.profile.confirmFact.handler(({ input, context }) =>
      facts.confirm(context.s, input.id, "web"),
    ),
    deleteFact: authed.profile.deleteFact.handler(async ({ input, context }) => ({
      undoToken: await facts.remove(context.s, input.id, "web"),
    })),
  };
}
