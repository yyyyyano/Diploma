// Публичный вход экрана auth (паспорт — CLAUDE.md рядом): маршрут routes/ импортирует только этот файл
// (web-routes-thin) — отсюда экспортируются страницы входа, регистрации, политики и подтверждения адреса и схемы
// их адресов.
import { lazyPage } from "../../lib/lazy-page.tsx";
export const LoginPage = lazyPage(() => import("./LoginPage.tsx"), "LoginPage");
export { LoginSearch } from "./model/search.ts";
export { VerifyEmailSearch } from "./model/verify-search.ts";
export { RecoverySearch } from "./model/recovery-search.ts";
export const PolicyPage = lazyPage(() => import("./PolicyPage.tsx"), "PolicyPage");
export const RecoveryPage = lazyPage(() => import("./RecoveryPage.tsx"), "RecoveryPage");
export const RegisterPage = lazyPage(() => import("./RegisterPage.tsx"), "RegisterPage");
export const VerifyEmailPage = lazyPage(() => import("./VerifyEmailPage.tsx"), "VerifyEmailPage");
