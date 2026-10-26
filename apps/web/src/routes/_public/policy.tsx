// Политика обработки персональных данных (PRIV-01): открыта всем — гостю до регистрации и вошедшему. Страница —
// features/auth.
import { createFileRoute } from "@tanstack/react-router";
import { PolicyPage } from "../../features/auth/index.ts";

export const Route = createFileRoute("/_public/policy")({
  staticData: { page: "policy" },
  component: PolicyPage,
});
