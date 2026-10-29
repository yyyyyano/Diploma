// «Операции» (TXN-01…05): таблица операций с поиском и фильтрами в адресе, карточка и ввод. Страница — features/operations.
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeftRight } from "lucide-react";
import { OperationsPage, OperationsSearch, toListInput } from "../../features/operations/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/operations")({
  validateSearch: OperationsSearch,
  staticData: {
    page: "operations",
    nav: { group: "money", order: 10, section: "operations", icon: ArrowLeftRight, phoneOrder: 2 },
  },
  loaderDeps: ({ search }) => search,
  // Запрос начинается при переходе, но маршрут его не ждёт: загрузку (скелетон) и ошибку показывает сама страница
  // (DES-16), а не граница ошибок и не «зависший» переход.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(
      orpc.transactions.list.queryOptions({ input: toListInput(deps) }),
    );
  },
  component: () => <OperationsPage search={Route.useSearch()} />,
});
