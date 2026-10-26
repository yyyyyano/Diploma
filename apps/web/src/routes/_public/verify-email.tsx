// Подтверждение адреса по ссылке из письма (AUTH-03): страница сама шлёт POST identity.verifyEmail — GET ссылки
// ничего не меняет (предпросмотр письма почтовиком не гасит ссылку). Страница — features/auth.
import { createFileRoute } from "@tanstack/react-router";
import { VerifyEmailPage, VerifyEmailSearch } from "../../features/auth/index.ts";

export const Route = createFileRoute("/_public/verify-email")({
  validateSearch: VerifyEmailSearch,
  staticData: { page: "verify-email" },
  component: () => <VerifyEmailPage search={Route.useSearch()} />,
});
