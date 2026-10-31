// «Администрирование → Законы» (ADM-10, LAW-40). Страница — features/admin (отдельным чанком).
import { createFileRoute } from "@tanstack/react-router";
import { AdminLawsPage } from "../../../features/admin/index.ts";
import { orpc } from "../../../lib/api.ts";

export const Route = createFileRoute("/_app/admin/laws")({
  staticData: { page: "admin-laws" },
  loader: ({ context }) =>
    context.queryClient.prefetchQuery(orpc.admin.lawsOverview.queryOptions()),
  component: AdminLawsPage,
});
