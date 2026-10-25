// Раздел «Администрирование» (ADM, DES-15): только роль admin — иначе «нет такой страницы». Сервер проверяет роль
// сам (процедуры admin); экраны раздела добавляет T-017, пункт меню — вместе с ними.
import { createFileRoute } from "@tanstack/react-router";
import { requireRole } from "../../lib/session.ts";

export const Route = createFileRoute("/_app/admin")({
  beforeLoad: async ({ context }) => ({ user: await requireRole(context.session, "admin") }),
});
