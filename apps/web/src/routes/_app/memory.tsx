// «Что ассистент знает обо мне» (PROF-05): пункт меню в группе «Профиль». Страница — features/memory.
import { createFileRoute } from "@tanstack/react-router";
import { BookUser } from "lucide-react";
import { MemoryPage } from "../../features/memory/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/memory")({
  staticData: {
    page: "memory",
    nav: { group: "profile", order: 10, section: "memory", icon: BookUser },
  },
  // prefetch, а не ensure: ошибку загрузки показывает сама страница (DES-16).
  loader: ({ context }) => context.queryClient.prefetchQuery(orpc.profile.facts.queryOptions()),
  component: MemoryPage,
});
