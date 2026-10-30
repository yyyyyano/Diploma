// Публичный вход экрана recurring (паспорт — CLAUDE.md рядом): маршрут routes/ импортирует только этот файл
// (web-routes-thin) — отсюда страница и схема адреса.
import { lazyPage } from "../../lib/lazy-page.tsx";
export const RecurringPage = lazyPage(() => import("./RecurringPage.tsx"), "RecurringPage");
export { RecurringSearch } from "./model/search.ts";
