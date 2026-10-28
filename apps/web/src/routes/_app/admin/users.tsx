// «Администрирование → Пользователи» (ADM-30). Страница — features/admin.
import { createFileRoute } from "@tanstack/react-router";
import { AdminUsersPage } from "../../../features/admin/index.ts";
import { orpc } from "../../../lib/api.ts";

export const Route = createFileRoute("/_app/admin/users")({
  staticData: { page: "admin-users" },
  // prefetch, а не ensure: ошибку загрузки показывает сама страница (DES-16).
  loader: ({ context }) => context.queryClient.prefetchQuery(orpc.admin.users.queryOptions()),
  component: AdminUsersPage,
});
