// «Регулярные платежи» (REC-01…05): найденные по истории платежи и подписки, решения человека. Страница — features/recurring.
import { createFileRoute } from "@tanstack/react-router";
import { Repeat } from "lucide-react";
import { RecurringPage, RecurringSearch } from "../../features/recurring/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/recurring")({
  validateSearch: RecurringSearch,
  staticData: {
    page: "recurring",
    nav: { group: "money", order: 40, section: "recurring", icon: Repeat },
  },
  // prefetch, а не ensure: ошибку загрузки показывает сама страница (DES-16), а не граница ошибок.
  loader: ({ context }) =>
    context.queryClient.prefetchQuery(orpc.recurring.list.queryOptions({ input: {} })),
  component: () => <RecurringPage search={Route.useSearch()} />,
});
