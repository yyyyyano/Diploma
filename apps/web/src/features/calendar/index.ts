// Публичный вход экрана calendar (паспорт — CLAUDE.md рядом): маршрут routes/ импортирует только этот файл (web-routes-thin) —
// отсюда страница (отдельным чанком: бюджет первой загрузки) и схема адреса.
import { lazyPage } from "../../lib/lazy-page.tsx";

export const CalendarPage = lazyPage(() => import("./CalendarPage.tsx"), "CalendarPage");
export { CalendarSearch } from "./model/search.ts";
