// «База законов» открыта всем (LEGAL-11): гость видит экран в рамке без меню, вошедший — в обычном каркасе. Пункт меню — в
// группе «Право и выгода». Страницы — features/laws: каталог (`/laws`) и читалка (`/laws/$pravoId?article=`).
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Scale } from "lucide-react";
import { GuestFrame } from "../../features/laws/index.ts";
import { sessionQuery } from "../../lib/session.ts";

export const Route = createFileRoute("/_public/laws")({
  staticData: {
    page: "laws",
    nav: { group: "law", order: 30, section: "laws", icon: Scale },
  },
  component: LawsLayout,
});

function LawsLayout() {
  const { Shell, session } = Route.useRouteContext();
  const viewer = useQuery(sessionQuery(session));
  if (viewer.isPending) return null;
  // Гость в кэше сессии — null.
  return viewer.data ? (
    <Shell />
  ) : (
    <GuestFrame>
      <Outlet />
    </GuestFrame>
  );
}
