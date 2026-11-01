// «Налоговые вычеты» (TAX-01…07): калькулятор «Обучение / Жильё / Дети» по ст. 209–211 НК. Страница — features/deductions.
import { createFileRoute } from "@tanstack/react-router";
import { Landmark } from "lucide-react";
import { DeductionsPage, DeductionsSearch } from "../../features/deductions/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/deductions")({
  validateSearch: DeductionsSearch,
  staticData: {
    page: "deductions",
    nav: { group: "law", order: 10, section: "deductions", icon: Landmark },
  },
  // prefetch, а не ensure: ошибку загрузки показывает сама страница (DES-16), а не граница ошибок.
  loader: ({ context }) => context.queryClient.prefetchQuery(orpc.profile.facts.queryOptions()),
  component: () => <DeductionsPage search={Route.useSearch()} />,
});
