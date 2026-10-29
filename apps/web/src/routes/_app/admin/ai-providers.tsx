// «Администрирование → Провайдеры ИИ» (ADM-50, LLM-08, LLM-09). Страница — features/admin.
import { createFileRoute } from "@tanstack/react-router";
import { AdminAiProvidersPage } from "../../../features/admin/index.ts";
import { orpc } from "../../../lib/api.ts";

export const Route = createFileRoute("/_app/admin/ai-providers")({
  staticData: { page: "admin-ai-providers" },
  loader: ({ context }) => context.queryClient.prefetchQuery(orpc.admin.aiProviders.queryOptions()),
  component: AdminAiProvidersPage,
});
