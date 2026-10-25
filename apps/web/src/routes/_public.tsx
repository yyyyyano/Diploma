// Страницы гостя (вход; регистрация, восстановление, «База законов» — следующие задачи): без каркаса раздела.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_public")({
  component: Outlet,
});
