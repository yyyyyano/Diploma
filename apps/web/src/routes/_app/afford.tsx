// «Могу ли я позволить покупку?» (AFF-01…08): три сценария покупки и безопасный платёж по ПДН. Страница — features/afford.
import { createFileRoute } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import { AffordPage, AffordSearch } from "../../features/afford/index.ts";

export const Route = createFileRoute("/_app/afford")({
  validateSearch: AffordSearch,
  staticData: {
    page: "afford",
    nav: { group: "law", order: 20, section: "afford", icon: ShoppingBag },
  },
  component: () => <AffordPage search={Route.useSearch()} />,
});
