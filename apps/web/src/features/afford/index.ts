// Публичный вход экрана afford (паспорт — CLAUDE.md рядом): маршрут routes/ импортирует только этот файл (web-routes-thin) —
// отсюда страница (отдельным чанком: бюджет первой загрузки) и схема адреса.
import { lazyPage } from "../../lib/lazy-page.tsx";

export const AffordPage = lazyPage(() => import("./AffordPage.tsx"), "AffordPage");
export { AffordSearch } from "./model/search.ts";
