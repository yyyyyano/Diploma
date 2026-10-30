// «Главная» (DASH-01…04): остатки, доходы и расходы, категории, динамика, лимиты и цели, платежи. Страница — features/dashboard.
import { createFileRoute } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import { HomePage, HomeSearch } from "../../features/dashboard/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/home")({
  validateSearch: HomeSearch,
  staticData: {
    page: "dashboard",
    nav: { group: "main", order: 10, section: "dashboard", icon: LayoutDashboard, phoneOrder: 1 },
  },
  loaderDeps: ({ search }) => search,
  // prefetch, а не ensure: загрузку и ошибку показывает сама страница (DES-16), а не граница ошибок.
  loader: ({ context, deps }) =>
    context.queryClient.prefetchQuery(
      orpc.dashboard.overview.queryOptions({
        input:
          deps.from !== undefined && deps.to !== undefined ? { from: deps.from, to: deps.to } : {},
      }),
    ),
  component: () => <HomePage search={Route.useSearch()} />,
});
