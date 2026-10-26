// Публичный вход экрана auth (паспорт — CLAUDE.md рядом): маршрут routes/ импортирует только этот файл
// (web-routes-thin) — отсюда экспортируются страницы входа, регистрации, политики и подтверждения адреса и схемы
// их адресов.
export { LoginPage } from "./LoginPage.tsx";
export { LoginSearch } from "./model/search.ts";
export { VerifyEmailSearch } from "./model/verify-search.ts";
export { RecoverySearch } from "./model/recovery-search.ts";
export { PolicyPage } from "./PolicyPage.tsx";
export { RecoveryPage } from "./RecoveryPage.tsx";
export { RegisterPage } from "./RegisterPage.tsx";
export { VerifyEmailPage } from "./VerifyEmailPage.tsx";
