// Публичный вход экрана settings (паспорт — CLAUDE.md рядом): маршрут routes/ импортирует только этот файл
// (web-routes-thin) — отсюда экспортируется страница экрана.
import { lazyPage } from "../../lib/lazy-page.tsx";
export { SettingsSearch } from "./model/search.ts";
export const SettingsPage = lazyPage(() => import("./SettingsPage.tsx"), "SettingsPage");
