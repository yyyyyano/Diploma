// Первый запуск (design/screens/Setup.dc.html, AUTH-10, ROLE-02, AUTH-05): создание администратора — email и пароль
// не короче 12 символов (SEC-01; макет пишет «10» — прав SPEC). Форма — на схеме контракта SetupInput. Успех — шаг
// «Сохраните код восстановления» (код показывается один раз), затем вход с пометкой «Администратор создан»; система уже
// настроена (CONFLICT) или вход не локальный (NOT_FOUND) — на вход: экран показывается один раз и только на этом
// компьютере. Шаг «Подготовка системы» (T-034, T-024) и контакт загрузчика законов (LAW-36, T-034) — с их задачами.
import { SetupInput } from "@kosht/contract";
import { Button, Checkbox, PasswordInput, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { formatFileSize } from "@kosht/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, ChevronRight, Lock, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RecoveryCode } from "../../entities/recovery-code/index.ts";
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
  const [recoveryCode, setRecoveryCode] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const setup = useMutation(
    orpc.identity.setup.mutationOptions({
      onSuccess: (result) => setRecoveryCode(result.recoveryCode),
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
          {recoveryCode !== undefined && preparing ? (
            <PrepareStep onContinue={() => void toLogin(true)} />
          ) : recoveryCode !== undefined ? (
            <div className={classes.card}>
              <div className={classes.heading}>
                <h1 className={classes.title}>{t("setup:code.title")}</h1>
                <p className={classes.intro}>{t("setup:code.intro")}</p>
              </div>
              <RecoveryCode code={recoveryCode} />
              <p className={classes.note}>
                <ShieldCheck size={18} strokeWidth={1.8} aria-hidden />
                {t("setup:code.hint")}
              </p>
              <Checkbox
                size="md"
                checked={saved}
                onChange={(event) => setSaved(event.currentTarget.checked)}
                label={t("setup:code.saved")}
              />
              <div className={classes.actions}>
                <Button
                  size="md"
                  disabled={!saved}
                  rightSection={<ChevronRight size={18} strokeWidth={1.8} aria-hidden />}
                  onClick={() => setPreparing(true)}
                >
                  {t("setup:code.continue")}
                </Button>
              </div>
            </div>
          ) : (
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
          )}
          <p className={classes.once}>{t("setup:once")}</p>
        </div>
      </main>
    </div>
  );
}

/**
 * «Готовим систему» (AUTH-10, NFR-25): после кода восстановления — прогресс скачивания локальных моделей. Опрос раз в 2 с
 * (у системной задачи нет домохозяйства, потока событий для неё нет); войти можно сразу — скачивание идёт в фоне.
 */
function PrepareStep({ onContinue }: { readonly onContinue: () => void }) {
  const { t } = useTranslation("setup");
  const progress = useQuery(
    orpc.llm.localModelsProgress.queryOptions({
      refetchInterval: (query) => (query.state.data?.state === "ready" ? false : 2000),
    }),
  );
  const data = progress.data;
  return (
    <div className={classes.card}>
      <div className={classes.heading}>
        <h1 className={classes.title}>{t("prepare.title")}</h1>
        <p className={classes.intro}>{t("prepare.intro")}</p>
      </div>
      <section className={classes.task} aria-labelledby="setup-models">
        <h2 id="setup-models" className={classes.taskTitle}>
          {t("prepare.models")}
        </h2>
        {progress.isError && <output className={classes.note}>{t("prepare.error")}</output>}
        {data !== undefined && (data.state === "downloading" || data.state === "failed") && (
          <>
            <progress
              className={classes.bar}
              value={data.bytesDone}
              max={Math.max(1, data.bytesTotal)}
              aria-label={t("prepare.modelsProgressLabel")}
            />
            <p className={classes.note}>
              {t("prepare.modelsProgress", {
                done: formatFileSize(data.bytesDone),
                total: formatFileSize(data.bytesTotal),
              })}
            </p>
          </>
        )}
        {data?.state === "downloading" && <p className={classes.hint}>{t("prepare.modelsNote")}</p>}
        {data?.state === "ready" && <p className={classes.hint}>{t("prepare.modelsDone")}</p>}
        {data?.state === "absent" && <p className={classes.hint}>{t("prepare.modelsAbsent")}</p>}
        {data?.state === "failed" && (
          <p className={classes.error} role="alert">
            <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
            {t("prepare.modelsFailed")}
          </p>
        )}
      </section>
      <div className={classes.actions}>
        <Button
          size="md"
          rightSection={<ChevronRight size={18} strokeWidth={1.8} aria-hidden />}
          onClick={onContinue}
        >
          {t("prepare.continue")}
        </Button>
      </div>
    </div>
  );
}
