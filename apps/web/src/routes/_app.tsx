// Раздел пользователя: все экраны после входа — внутри каркаса (меню, верхняя и нижняя панели). Каркас приходит
// из контекста роутера: маршруты не импортируют app (ADR-0014). Проверку входа добавляет T-009 (identity).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { Shell } = Route.useRouteContext();
  return <Shell />;
}
