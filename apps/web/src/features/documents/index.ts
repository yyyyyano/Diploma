// Публичный вход экрана documents (паспорт — CLAUDE.md рядом): маршрут routes/ импортирует только этот файл.
import { lazyPage } from "../../lib/lazy-page.tsx";
export const DocumentsPage = lazyPage(() => import("./DocumentsPage.tsx"), "DocumentsPage");
export { DocumentsSearch } from "./model/search.ts";
