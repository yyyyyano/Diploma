// Роутер сайта (ADR-0013, ADR-0014): дерево файловых маршрутов и то, что app подставляет им через контекст, —
// клиент запросов, источник сессии и каркас. Граница ошибок и «нет такой страницы» — общие для всех маршрутов.
import type { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import type { SessionSource } from "../lib/session.ts";
import { routeTree } from "../routeTree.gen.ts";
import { ErrorScreen, NotFoundScreen } from "./ErrorScreen.tsx";
import { AppShell } from "./shell/AppShell.tsx";

export interface AppRouterDeps {
  readonly queryClient: QueryClient;
  readonly session: SessionSource;
  /** Своя история (тесты — память); по умолчанию — адресная строка браузера. */
  readonly history?: RouterHistory;
}

export function createAppRouter({ queryClient, session, history }: AppRouterDeps) {
  return createRouter({
    routeTree,
    context: { queryClient, session, Shell: AppShell },
    defaultErrorComponent: ErrorScreen,
    defaultNotFoundComponent: NotFoundScreen,
    defaultPreload: "intent",
    // Данные держит TanStack Query: роутер не кэширует результаты loader сам.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    ...(history === undefined ? {} : { history }),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
