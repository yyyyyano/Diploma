// /dev/gallery — витрина дизайн-системы: только разработка и сборка --mode e2e (в боевую сборку файл не попадает,
// vite.config.ts → routeFileIgnorePattern). Маршрут тонкий: страница — features/dev-gallery.
import { createFileRoute } from "@tanstack/react-router";
import { GalleryPage } from "../features/dev-gallery/index.ts";

export const Route = createFileRoute("/dev/gallery")({
  component: GalleryPage,
});
