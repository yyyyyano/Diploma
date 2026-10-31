// «/admin» — первая вкладка раздела: «Законы».
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/laws", replace: true });
  },
});
