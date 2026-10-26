// Регистрация (AUTH-01…03): вошедшему здесь делать нечего — на «/». Страница — features/auth.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { RegisterPage } from "../../features/auth/index.ts";
import { currentUser } from "../../lib/session.ts";

export const Route = createFileRoute("/_public/register")({
  staticData: { page: "register" },
  beforeLoad: async ({ context }) => {
    if ((await currentUser(context)) !== undefined) throw redirect({ to: "/" });
  },
  component: RegisterPage,
});
