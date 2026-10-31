// Публичный вход экрана admin (паспорт — CLAUDE.md рядом): маршруты routes/_app/admin* импортируют только этот файл
// (web-routes-thin) — каркас раздела и страницы вкладок.
// «Законы» — отдельным чанком (`lazyPage`): таблицы, формы и редактор справочников не должны ехать в первую загрузку (бюджет CONSTRAINTS).
import { lazyPage } from "../../lib/lazy-page.tsx";

export const AdminLawsPage = lazyPage(() => import("./AdminLawsPage.tsx"), "AdminLawsPage");
export const AdminRatesPage = lazyPage(() => import("./AdminRatesPage.tsx"), "AdminRatesPage");
export { AdminAiProvidersPage } from "./AdminAiProvidersPage.tsx";
export { AdminAiRequestsPage } from "./AdminAiRequestsPage.tsx";
export { AdminLayout } from "./AdminLayout.tsx";
export { AdminSystemPage } from "./AdminSystemPage.tsx";
export { AdminUsersPage } from "./AdminUsersPage.tsx";
