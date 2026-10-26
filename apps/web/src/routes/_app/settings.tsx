// «Настройки» (Settings.dc.html): пункт меню в группе «Профиль». Страница — features/settings.
import { createFileRoute } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import { SettingsPage } from "../../features/settings/index.ts";

export const Route = createFileRoute("/_app/settings")({
  staticData: {
    page: "settings",
    nav: { group: "profile", order: 20, section: "settings", icon: SlidersHorizontal },
  },
  component: SettingsPage,
});
