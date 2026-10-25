// Раздел пользователя: все экраны после входа — внутри каркаса (меню, верхняя и нижняя панели). Без сессии — на
// вход (AUTH-08). Каркас приходит из контекста роутера: маршруты не импортируют app (ADR-0014).
import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "../lib/session.ts";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context }) => ({ user: await requireUser(context) }),
  component: AppLayout,
});

function AppLayout() {
  const { Shell } = Route.useRouteContext();
  return <Shell />;
}
