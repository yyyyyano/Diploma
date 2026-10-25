// Вход (design/screens/Login.dc.html, AUTH-08): панель бренда и форма email + пароль. Форма — на схеме входа
// контракта (SignInInput), тексты ошибок — из словаря; ответ сервера INVALID_CREDENTIALS — «Неверный email или
// пароль» без уточнения, что именно. После входа кэш запросов очищается целиком (данные прежнего пользователя не
// должны мелькнуть) и стартовый маршрут ведёт в раздел. «Забыли пароль?», код восстановления, демо-вход и регистрация
// — T-013, T-054, T-012; ссылка «Первый запуск» — только пока он доступен.
import { SignInInput } from "@kosht/contract";
import { Button, PasswordInput, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, FileText, Landmark, Scale, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf } from "../../lib/errors.ts";
import { Logo } from "../../ui/index.ts";
import classes from "./LoginPage.module.css";
import type { LoginSearch } from "./model/search.ts";

const POINTS = [
  { key: "receipts", icon: FileText },
  { key: "deductions", icon: Landmark },
  { key: "laws", icon: Scale },
] as const;

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
    <div className={classes.wrap}>
      <aside className={classes.brand}>
        <Logo on="dark" />
        <div className={classes.pitch}>
          <p className={classes.pitchTitle}>{t("auth:brand.title")}</p>
          <p className={classes.pitchText}>{t("auth:brand.text")}</p>
        </div>
        <ul className={classes.points}>
          {POINTS.map(({ key, icon: Icon }) => (
            <li key={key}>
              <span className={classes.pointIcon}>
                <Icon size={20} strokeWidth={1.8} aria-hidden />
              </span>
              <span>
                <span className={classes.pointTitle}>{t(`auth:brand.points.${key}.title`)}</span>
                <span className={classes.pointText}>{t(`auth:brand.points.${key}.text`)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className={classes.privacy}>
          <ShieldCheck size={16} strokeWidth={1.8} aria-hidden />
          {t("auth:brand.privacy")}
        </p>
      </aside>
      <main className={classes.side}>
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
              {t(`errors:${serverError}`)}
            </p>
          )}
          <form
            className={classes.form}
            noValidate
            onSubmit={form.onSubmit((values) => signIn.mutate(values))}
          >
            <TextInput
              label={t("auth:login.email")}
              type="email"
              autoComplete="username"
              key={form.key("email")}
              {...form.getInputProps("email")}
              error={form.errors["email"] === undefined ? undefined : t("auth:login.emailInvalid")}
            />
            <PasswordInput
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
        </div>
        {status.data?.setupAvailable === true && (
          <nav className={classes.footer} aria-label={t("auth:footer.label")}>
            <Link to="/setup">{t("auth:footer.setup")}</Link>
          </nav>
        )}
      </main>
    </div>
  );
}
