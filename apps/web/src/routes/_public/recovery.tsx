// Восстановление доступа (AUTH-04, AUTH-05): запрос ссылки, новый пароль по ссылке, вход с кодом восстановления.
// Страница — features/auth.
import { createFileRoute } from "@tanstack/react-router";
import { RecoveryPage, RecoverySearch } from "../../features/auth/index.ts";

export const Route = createFileRoute("/_public/recovery")({
  validateSearch: RecoverySearch,
  staticData: { page: "recovery" },
  component: () => <RecoveryPage search={Route.useSearch()} />,
});
