// «Лимиты и цели» (BUD-01…07): лимиты месяца и цели с прогрессом. Страница — features/budget.
import { createFileRoute } from "@tanstack/react-router";
import { Target } from "lucide-react";
import { BudgetPage } from "../../features/budget/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/budget")({
  staticData: {
    page: "budget",
    nav: { group: "money", order: 50, section: "budget", icon: Target },
  },
  // prefetch, а не ensure: ошибку загрузки показывает сама страница (DES-16), а не граница ошибок.
  loader: ({ context }) =>
    context.queryClient.prefetchQuery(orpc.budgets.overview.queryOptions({ input: {} })),
  component: BudgetPage,
});
