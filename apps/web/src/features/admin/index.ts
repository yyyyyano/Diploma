// Публичный вход экрана admin (паспорт — CLAUDE.md рядом): маршруты routes/_app/admin* импортируют только этот файл
// (web-routes-thin) — каркас раздела и страницы вкладок.
// Страницы вкладок — отдельными чанками (`lazyPage`): таблицы, формы и редактор справочников администратора не должны ехать
// в первую загрузку каждого пользователя (бюджет CONSTRAINTS; T-043 — запас под чат).
import { lazyPage } from "../../lib/lazy-page.tsx";

export const AdminLawsPage = lazyPage(() => import("./AdminLawsPage.tsx"), "AdminLawsPage");
export const AdminRatesPage = lazyPage(() => import("./AdminRatesPage.tsx"), "AdminRatesPage");
export { AdminLayout } from "./AdminLayout.tsx";
export const AdminAiProvidersPage = lazyPage(
  () => import("./AdminAiProvidersPage.tsx"),
  "AdminAiProvidersPage",
);
export const AdminAiRequestsPage = lazyPage(
  () => import("./AdminAiRequestsPage.tsx"),
  "AdminAiRequestsPage",
);
export const AdminSystemPage = lazyPage(() => import("./AdminSystemPage.tsx"), "AdminSystemPage");
export const AdminUsersPage = lazyPage(() => import("./AdminUsersPage.tsx"), "AdminUsersPage");
