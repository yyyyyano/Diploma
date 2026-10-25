// Стартовый маршрут «/» (AUTH-10, NFR-24): вошедший — в раздел пользователя («Счета», пока нет главной — T-033);
// гость — на первый запуск, если система не инициализирована и вход локальный, иначе — на вход.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { orpc } from "../lib/api.ts";
import { currentUser } from "../lib/session.ts";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ context }) => {
    if ((await currentUser(context)) !== undefined) throw redirect({ to: "/accounts" });
    const status = await context.queryClient.fetchQuery(orpc.identity.status.queryOptions());
    throw redirect({ to: status.setupAvailable ? "/setup" : "/login" });
  },
});
