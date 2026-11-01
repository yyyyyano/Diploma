// «Календарь» (CAL-01…08): месяц и список «Ближайшие», события и напоминания. Страница — features/calendar.
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { CalendarPage, CalendarSearch } from "../../features/calendar/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/calendar")({
  validateSearch: CalendarSearch,
  staticData: {
    page: "calendar",
    nav: { group: "money", order: 60, section: "calendar", icon: CalendarDays },
  },
  loaderDeps: ({ search }) => ({ view: search.view, month: search.month }),
  // prefetch, а не ensure: ошибку загрузки показывает сама страница (DES-16), а не граница ошибок.
  loader: ({ context, deps }) =>
    deps.view === "list"
      ? context.queryClient.prefetchQuery(orpc.calendar.upcoming.queryOptions())
      : context.queryClient.prefetchQuery(
          orpc.calendar.month.queryOptions({
            input: deps.month === undefined ? {} : { month: deps.month },
          }),
        ),
  component: () => <CalendarPage search={Route.useSearch()} />,
});
