// «Администрирование → Таблица ставок» (ADM-11, TAX-03, LAW-33). Страница — features/admin (отдельным чанком).
import { createFileRoute } from "@tanstack/react-router";
import { AdminRatesPage } from "../../../features/admin/index.ts";
import { orpc } from "../../../lib/api.ts";

export const Route = createFileRoute("/_app/admin/rates")({
  staticData: { page: "admin-rates" },
  loader: ({ context }) => context.queryClient.prefetchQuery(orpc.admin.rates.queryOptions()),
  component: AdminRatesPage,
});
