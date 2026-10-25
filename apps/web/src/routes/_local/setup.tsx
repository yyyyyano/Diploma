// Первый запуск (AUTH-10): только пока система не инициализирована и только на локальном входе — иначе вход.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { SetupPage } from "../../features/setup/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_local/setup")({
  staticData: { page: "setup" },
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.fetchQuery(orpc.identity.status.queryOptions());
    if (!status.setupAvailable) throw redirect({ to: "/login" });
  },
  component: SetupPage,
});
