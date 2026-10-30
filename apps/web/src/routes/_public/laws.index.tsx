// Каталог «Базы законов»: поиск, тема и состояние — в адресе (`?group=&status=&q=`).
import { createFileRoute } from "@tanstack/react-router";
import { LawsPage, LawsSearch } from "../../features/laws/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_public/laws/")({
  validateSearch: LawsSearch,
  // prefetch, а не ensure: загрузку и ошибку показывает сама страница (DES-16).
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(orpc.legalBase.catalog.queryOptions());
  },
  component: () => <LawsPage search={Route.useSearch()} />,
});
