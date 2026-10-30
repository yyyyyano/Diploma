// Публичный вход экрана dashboard (паспорт — CLAUDE.md рядом): маршрут routes/ импортирует только этот файл (web-routes-thin).
import { lazyPage } from "../../lib/lazy-page.tsx";
export const HomePage = lazyPage(() => import("./HomePage.tsx"), "HomePage");
export { HomeSearch } from "./model/search.ts";
