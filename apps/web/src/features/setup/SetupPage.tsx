// Первый запуск (design/screens/Setup.dc.html, AUTH-10, ROLE-02): создание администратора — email и пароль не короче
// 12 символов (SEC-01; макет пишет «10» — прав SPEC). Форма — на схеме контракта SetupInput. Успех — на вход с
// пометкой «Администратор создан»; система уже настроена (CONFLICT) или вход не локальный (NOT_FOUND) — тоже на
// вход: экран показывается один раз и только на этом компьютере. Шаги «Код восстановления» (T-013) и «Подготовка
// системы» (T-034, T-024), контакт загрузчика законов (LAW-36, T-034) появятся со своими задачами.
import { SetupInput } from "@kosht/contract";
import { Button, PasswordInput, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, ChevronRight, Lock, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf } from "../../lib/errors.ts";
import { Logo } from "../../ui/index.ts";
import classes from "./SetupPage.module.css";

export function SetupPage() {
  const { t } = useTranslation(["setup", "auth", "errors"]);
  const navigate = useNavigate();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { email: "", password: "" },
    validate: schemaResolver(SetupInput, { sync: true }),
  });
  const toLogin = (created: boolean) =>
    navigate({ to: "/login", search: created ? { created: true } : {} });
  const setup = useMutation(
    orpc.identity.setup.mutationOptions({
      onSuccess: () => toLogin(true),
      onError: async (error) => {
        const code = errorCodeOf(error);
        if (code === "CONFLICT" || code === "NOT_FOUND") await toLogin(false);
      },
    }),
  );
  const serverError = setup.error === null ? undefined : errorCodeOf(setup.error);

  return (
    <div className={classes.wrap}>
      <header className={classes.top}>
        <Logo />
        <span className={classes.topTitle}>{t("setup:topTitle")}</span>
        <span className={classes.local}>
          <Lock size={16} strokeWidth={1.8} aria-hidden />
          {t("setup:localOnly")}
        </span>
      </header>
      <main className={classes.main}>
        <div className={classes.col}>
          <div className={classes.card}>
            <div className={classes.heading}>
              <h1 className={classes.title}>{t("setup:title")}</h1>
              <p className={classes.intro}>{t("setup:intro")}</p>
            </div>
            {serverError !== undefined && (
              <p className={classes.error} role="alert">
                <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
                {t(`errors:${serverError}`)}
              </p>
            )}
            <form
              className={classes.form}
              noValidate
              onSubmit={form.onSubmit((values) => setup.mutate(values))}
            >
              <div className={classes.grid}>
                <TextInput
                  size="md"
                  label={t("setup:email")}
                  placeholder={t("setup:emailPlaceholder")}
                  type="email"
                  autoComplete="username"
                  key={form.key("email")}
                  {...form.getInputProps("email")}
                  error={form.errors["email"] === undefined ? undefined : t("setup:emailInvalid")}
                />
                <PasswordInput
                  size="md"
                  label={t("setup:password")}
                  placeholder={t("setup:passwordPlaceholder")}
                  description={t("setup:passwordHint")}
                  inputWrapperOrder={["label", "input", "description", "error"]}
                  autoComplete="new-password"
                  visibilityToggleButtonProps={{ "aria-label": t("auth:password.show") }}
                  key={form.key("password")}
                  {...form.getInputProps("password")}
                  error={
                    form.errors["password"] === undefined ? undefined : t("setup:passwordShort")
                  }
                />
              </div>
              <p className={classes.note}>
                <ShieldCheck size={18} strokeWidth={1.8} aria-hidden />
                {t("setup:privacy")}
              </p>
              <div className={classes.actions}>
                <Button
                  type="submit"
                  size="md"
                  loading={setup.isPending}
                  rightSection={<ChevronRight size={18} strokeWidth={1.8} aria-hidden />}
                >
                  {t("setup:submit")}
                </Button>
              </div>
            </form>
          </div>
          <p className={classes.once}>{t("setup:once")}</p>
        </div>
      </main>
    </div>
  );
}
