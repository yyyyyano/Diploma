// Контекст роутера (ADR-0014): то, что app подставляет маршрутам. Маршруты тонкие и не импортируют app, поэтому
// каркас (Shell) приходит им сюда — как реализация, выбранная корнем сайта.
import type { QueryClient } from "@tanstack/react-query";
import type { ComponentType } from "react";
import type { SessionSource } from "./session.ts";

export interface RouterContext {
  readonly queryClient: QueryClient;
  readonly session: SessionSource;
  /** Каркас раздела пользователя (меню, верхняя и нижняя панели); внутри — Outlet маршрута. */
  readonly Shell: ComponentType;
}
