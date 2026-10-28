// Анкета на 1 минуту (AUTH-07): после первого входа, без каркаса раздела (своя шапка со знаком). Без сессии — на вход;
// анкету уже прошли или пропустили — на стартовый «/». Страница — features/onboarding.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { OnboardingPage } from "../features/onboarding/index.ts";
import { orpc } from "../lib/api.ts";
import { requireUser } from "../lib/session.ts";

export const Route = createFileRoute("/onboarding")({
  staticData: { page: "onboarding" },
  beforeLoad: async ({ context }) => {
    await requireUser(context);
    const { status } = await context.queryClient.fetchQuery(orpc.profile.onboarding.queryOptions());
    if (status === "done") throw redirect({ to: "/" });
  },
  component: OnboardingPage,
});
