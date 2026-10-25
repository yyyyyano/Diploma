// «Счета» (STMT-01): список счетов домохозяйства. Страница — features/accounts.
import { createFileRoute } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { AccountsPage } from "../../features/accounts/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/accounts")({
  staticData: {
    page: "accounts",
    nav: { group: "money", order: 30, section: "accounts", icon: Wallet },
  },
  // prefetch, а не ensure: ошибку загрузки показывает сама страница (DES-16), а не граница ошибок.
  loader: ({ context }) => context.queryClient.prefetchQuery(orpc.accounts.list.queryOptions()),
  component: AccountsPage,
});
