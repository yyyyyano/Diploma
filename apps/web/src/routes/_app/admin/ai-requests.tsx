// «Администрирование → Запросы к ИИ» (ADM-20, ADM-21, ADM-22). Период — в адресе (`?period=day|week|month`).
import { AiPeriod } from "@kosht/contract";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AdminAiRequestsPage } from "../../../features/admin/index.ts";
import { orpc } from "../../../lib/api.ts";

const Search = z.object({ period: AiPeriod.catch("day") });

export const Route = createFileRoute("/_app/admin/ai-requests")({
  validateSearch: Search,
  staticData: { page: "admin-ai-requests" },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.prefetchQuery(
      orpc.admin.aiUsage.queryOptions({ input: { period: deps.period } }),
    ),
  component: () => <AdminAiRequestsPage period={Route.useSearch().period} />,
});
