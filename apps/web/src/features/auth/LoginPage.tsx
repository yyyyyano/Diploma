// Вход (design/screens/Login.dc.html, AUTH-08): панель бренда и форма email + пароль. Форма — на схеме входа
// контракта (SignInInput), тексты ошибок — из словаря; ответ сервера INVALID_CREDENTIALS — «Неверный email или
// пароль» без уточнения, что именно. После входа кэш запросов очищается целиком (данные прежнего пользователя не
// должны мелькнуть) и стартовый маршрут ведёт в раздел. Ссылки на регистрацию и политику — всегда, «Первый запуск» —
// только пока он доступен; «Забыли пароль?» и «Войти с кодом восстановления» ведут на /recovery. Заблокированному и
// при превышении частоты — заголовок и текст из словаря («попробуйте через N мин.»). Демо-вход — T-054.
import { SignInInput } from "@kosht/contract";
import { Button, PasswordInput, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { AuthLayout } from "./AuthLayout.tsx";
import classes from "./AuthLayout.module.css";
import type { LoginSearch } from "./model/search.ts";

export function LoginPage({ search }: { readonly search: LoginSearch }) {
  const { t } = useTranslation(["auth", "errors"]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const status = useQuery(orpc.identity.status.queryOptions());
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { email: "", password: "" },
    validate: schemaResolver(SignInInput, { sync: true }),
  });
  const signIn = useMutation(
    orpc.identity.signIn.mutationOptions({
      onSuccess: async () => {
        queryClient.clear();
        await navigate({ to: "/" });
      },
    }),
  );
  const serverError = signIn.error === null ? undefined : errorCodeOf(signIn.error);

  return (
    <AuthLayout>
      <div className={classes.card}>
        <div className={classes.heading}>
          <h1 className={classes.title}>{t("auth:login.title")}</h1>
          <p className={classes.subtitle}>{t("auth:login.subtitle")}</p>
        </div>
        {search.created === true && (
          <output className={classes.ok}>
            <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
            {t("auth:login.created")}
          </output>
        )}
        {serverError !== undefined && (
          <p className={classes.error} role="alert">
            <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
            <span>
              {serverError === "ACCOUNT_BLOCKED" && (
                <strong>{t("auth:login.blockedTitle")} </strong>
              )}
              {serverError === "RATE_LIMITED" && (
                <strong>{t("auth:login.rateLimitedTitle")} </strong>
              )}
              {t(`errors:${serverError}`, errorParamsOf(signIn.error))}
            </span>
          </p>
        )}
        <form
          className={classes.form}
          noValidate
          onSubmit={form.onSubmit((values) => signIn.mutate(values))}
        >
          <TextInput
            size="md"
            label={t("auth:login.email")}
            type="email"
            autoComplete="username"
            key={form.key("email")}
            {...form.getInputProps("email")}
            error={form.errors["email"] === undefined ? undefined : t("auth:login.emailInvalid")}
          />
          <PasswordInput
            size="md"
            label={t("auth:login.password")}
            placeholder={t("auth:login.passwordPlaceholder")}
            autoComplete="current-password"
            visibilityToggleButtonProps={{ "aria-label": t("auth:password.show") }}
            key={form.key("password")}
            {...form.getInputProps("password")}
            error={
              form.errors["password"] === undefined ? undefined : t("auth:login.passwordRequired")
            }
          />
          <Button type="submit" size="md" fullWidth loading={signIn.isPending}>
            {t("auth:login.submit")}
          </Button>
        </form>
        <nav className={classes.links} aria-label={t("auth:recovery.title")}>
          <Link to="/recovery">{t("auth:login.forgot")}</Link>
          <Link to="/recovery" search={{ mode: "code" }}>
            {t("auth:login.withCode")}
          </Link>
        </nav>
        <p className={classes.switch}>
          {t("auth:login.noAccount")} <Link to="/register">{t("auth:login.register")}</Link>
        </p>
      </div>
      <nav className={classes.footer} aria-label={t("auth:footer.label")}>
        <Link to="/policy">{t("auth:footer.policy")}</Link>
        {status.data?.setupAvailable === true && <Link to="/setup">{t("auth:footer.setup")}</Link>}
      </nav>
    </AuthLayout>
  );
}
