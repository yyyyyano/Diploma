// Корень маршрутов (ADR-0014): только контекст — каркас, ошибки и «нет страницы» подставляет app (createAppRouter).
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { RouterContext } from "../lib/router-context.ts";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
});
