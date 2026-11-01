// Публичный вход экрана deductions (паспорт — CLAUDE.md рядом): маршрут routes/ импортирует только этот файл (web-routes-thin) —
// отсюда страница (отдельным чанком: бюджет первой загрузки) и схема адреса.
import { lazyPage } from "../../lib/lazy-page.tsx";

export const DeductionsPage = lazyPage(() => import("./DeductionsPage.tsx"), "DeductionsPage");
export { DeductionsSearch } from "./model/search.ts";
