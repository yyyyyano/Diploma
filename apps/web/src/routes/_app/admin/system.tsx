// «Администрирование → Система» (ADM-60). Страница — features/admin.
import { createFileRoute } from "@tanstack/react-router";
import { AdminSystemPage } from "../../../features/admin/index.ts";
import { orpc } from "../../../lib/api.ts";

export const Route = createFileRoute("/_app/admin/system")({
  staticData: { page: "admin-system" },
  loader: ({ context }) => context.queryClient.prefetchQuery(orpc.admin.system.queryOptions()),
  component: AdminSystemPage,
});
