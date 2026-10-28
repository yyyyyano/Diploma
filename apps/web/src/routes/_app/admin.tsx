// Раздел «Администрирование» (ADM, DES-15): только роль admin — иначе «нет такой страницы»; сервер проверяет роль сам
// (процедуры admin). Пункт меню — только администратору. Вкладки — вложенные маршруты /admin/users, /admin/system.
import { createFileRoute } from "@tanstack/react-router";
import { Shield } from "lucide-react";
import { AdminLayout } from "../../features/admin/index.ts";
import { requireRole } from "../../lib/session.ts";

export const Route = createFileRoute("/_app/admin")({
  beforeLoad: async ({ context }) => ({ user: await requireRole(context.session, "admin") }),
  staticData: {
    page: "admin",
    nav: { group: "profile", order: 30, section: "admin", icon: Shield, role: "admin" },
  },
  component: AdminLayout,
});
