// Страницы только для этого компьютера (первый запуск; почтовый ящик — T-012): без каркаса раздела. Сервер
// закрывает их процедуры на сетевом входе сам (localOnly → NOT_FOUND).
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_local")({
  component: Outlet,
});
