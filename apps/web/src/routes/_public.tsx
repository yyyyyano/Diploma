// Страницы гостя (вход, регистрация, подтверждение адреса, восстановление доступа, политика; «База законов» —
// T-038): без каркаса раздела.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_public")({
  component: Outlet,
});
