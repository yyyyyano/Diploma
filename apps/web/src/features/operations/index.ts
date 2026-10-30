// Публичный вход экрана operations (паспорт — CLAUDE.md рядом): маршрут routes/ импортирует только этот файл
// (web-routes-thin) — страница и схема адреса.
import { lazyPage } from "../../lib/lazy-page.tsx";
export { OperationsSearch, toListInput } from "./model/search.ts";
export const OperationsPage = lazyPage(() => import("./OperationsPage.tsx"), "OperationsPage");
