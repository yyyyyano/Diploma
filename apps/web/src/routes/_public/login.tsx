// Вход (AUTH-08): вошедшему здесь делать нечего — на «/». Страница — features/auth.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginPage, LoginSearch } from "../../features/auth/index.ts";
import { currentUser } from "../../lib/session.ts";

export const Route = createFileRoute("/_public/login")({
  validateSearch: LoginSearch,
  staticData: { page: "login" },
  beforeLoad: async ({ context }) => {
    if ((await currentUser(context)) !== undefined) throw redirect({ to: "/" });
  },
  component: () => <LoginPage search={Route.useSearch()} />,
});
