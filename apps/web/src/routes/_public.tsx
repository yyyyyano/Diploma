// Страницы гостя (вход, регистрация, подтверждение адреса, политика; восстановление и «База законов» — T-013, T-038):
// без каркаса раздела.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_public")({
  component: Outlet,
});
