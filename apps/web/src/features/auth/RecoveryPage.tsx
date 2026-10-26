// Восстановление доступа (AUTH-04, AUTH-05; состояние forgot-password макета design/screens/Login.dc.html — отдельной
// страницей /recovery, DES-00): три вида по адресу. Без параметров — запрос ссылки на почту (ответ одинаковый, есть ли
// такой адрес; «Проверьте почту» и ссылка на локальный ящик, пока почта не настроена). token — новый пароль по ссылке
// из письма (ссылка использована или устарела — LINK_INVALID и «Запросить новую ссылку»). mode=code — вход с кодом
// восстановления: новый пароль, вход и новый код (показать один раз).
import { Button, Checkbox, PasswordInput, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, MailCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RecoveryCode } from "../../entities/recovery-code/index.ts";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { AuthLayout } from "./AuthLayout.tsx";
import layout from "./AuthLayout.module.css";
import { CodeForm, NewPasswordForm, ResetRequestForm } from "./model/recovery-forms.ts";
import type { RecoverySearch } from "./model/recovery-search.ts";

export function RecoveryPage({ search }: { readonly search: RecoverySearch }) {
  let content;
  if (search.token !== undefined) content = <NewPassword token={search.token} />;
  else if (search.mode === "code") content = <WithCode />;
  else content = <RequestLink />;
  return <AuthLayout>{content}</AuthLayout>;
}

function ServerError({ error }: { readonly error: unknown }) {
  const { t } = useTranslation("errors");
  return (
    <p className={layout.error} role="alert">
      <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
      {t(errorCodeOf(error), errorParamsOf(error))}
    </p>
  );
}

function RequestLink() {
  const { t } = useTranslation("auth");
  const mail = useQuery(orpc.mail.status.queryOptions());
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { email: "" },
    validate: schemaResolver(ResetRequestForm, { sync: true }),
  });
  const request = useMutation(orpc.identity.requestPasswordReset.mutationOptions());

  if (request.isSuccess) {
    return (
      <div className={layout.card}>
        <MailCheck size={36} strokeWidth={1.8} aria-hidden className={layout.icon} />
        <div className={layout.heading}>
          <h1 className={layout.title}>{t("recovery.sentTitle")}</h1>
          <p className={layout.subtitle}>
            {t("recovery.sentText", { email: request.variables.email })}
          </p>
        </div>
        {mail.data?.mailboxAvailable === true && (
          <>
            <Button component={Link} to="/mailbox" size="md" fullWidth>
              {t("recovery.mailbox")}
            </Button>
            <p className={layout.subtitle}>{t("recovery.mailboxHint")}</p>
          </>
        )}
        <p className={layout.switch}>
          <Link to="/login">{t("recovery.toLogin")}</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={layout.card}>
      <div className={layout.heading}>
        <h1 className={layout.title}>{t("recovery.title")}</h1>
        <p className={layout.subtitle}>{t("recovery.subtitle")}</p>
      </div>
      {request.isError && <ServerError error={request.error} />}
      <form
        className={layout.form}
        noValidate
        onSubmit={form.onSubmit((values) => request.mutate({ email: values.email.trim() }))}
      >
        <TextInput
          size="md"
          label={t("recovery.email")}
          type="email"
          autoComplete="username"
          key={form.key("email")}
          {...form.getInputProps("email")}
          error={form.errors["email"] === undefined ? undefined : t("recovery.emailInvalid")}
        />
        <Button type="submit" size="md" fullWidth loading={request.isPending}>
          {t("recovery.send")}
        </Button>
      </form>
      <div className={layout.help}>
        <p className={layout.helpTitle}>{t("recovery.noMail")}</p>
        <p>
          <Link to="/recovery" search={{ mode: "code" }}>
            {t("recovery.noMailCode")}
          </Link>
        </p>
      </div>
      <p className={layout.switch}>
        <Link to="/login">{t("recovery.toLogin")}</Link>
      </p>
    </div>
  );
}

function NewPassword({ token }: { readonly token: string }) {
  const { t } = useTranslation("auth");
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { password: "", repeat: "" },
    validate: schemaResolver(NewPasswordForm, { sync: true }),
  });
  const reset = useMutation(orpc.identity.resetPassword.mutationOptions());

  if (reset.isSuccess) {
    return (
      <div className={layout.card}>
        <div className={layout.heading}>
          <h1 className={layout.title}>{t("recovery.reset.doneTitle")}</h1>
        </div>
        <output className={layout.ok}>
          <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
          {t("recovery.reset.doneText")}
        </output>
        <Button component={Link} to="/login" size="md" fullWidth>
          {t("recovery.reset.signIn")}
        </Button>
      </div>
    );
  }

  return (
    <div className={layout.card}>
      <div className={layout.heading}>
        <h1 className={layout.title}>{t("recovery.reset.title")}</h1>
        <p className={layout.subtitle}>{t("recovery.reset.subtitle")}</p>
      </div>
      {reset.isError && <ServerError error={reset.error} />}
      {reset.isError && errorCodeOf(reset.error) === "LINK_INVALID" && (
        <p className={layout.switch}>
          <Link to="/recovery">{t("recovery.reset.again")}</Link>
        </p>
      )}
      <form
        className={layout.form}
        noValidate
        onSubmit={form.onSubmit((values) => reset.mutate({ token, password: values.password }))}
      >
        <PasswordInput
          size="md"
          label={t("recovery.reset.password")}
          autoComplete="new-password"
          visibilityToggleButtonProps={{ "aria-label": t("password.show") }}
          key={form.key("password")}
          {...form.getInputProps("password")}
          error={form.errors["password"] === undefined ? undefined : t("recovery.passwordShort")}
        />
        <PasswordInput
          size="md"
          label={t("recovery.reset.repeat")}
          autoComplete="new-password"
          visibilityToggleButtonProps={{ "aria-label": t("password.show") }}
          key={form.key("repeat")}
          {...form.getInputProps("repeat")}
          error={form.errors["repeat"] === undefined ? undefined : t("recovery.mismatch")}
        />
        <Button type="submit" size="md" fullWidth loading={reset.isPending}>
          {t("recovery.reset.submit")}
        </Button>
      </form>
    </div>
  );
}

function WithCode() {
  const { t } = useTranslation("auth");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { email: "", code: "", password: "", repeat: "" },
    validate: schemaResolver(CodeForm, { sync: true }),
  });
  const recover = useMutation(
    orpc.identity.recoverWithCode.mutationOptions({ onSuccess: () => queryClient.clear() }),
  );

  if (recover.isSuccess) {
    return (
      <div className={layout.card}>
        <div className={layout.heading}>
          <h1 className={layout.title}>{t("recovery.code.doneTitle")}</h1>
          <p className={layout.subtitle}>{t("recovery.code.doneText")}</p>
        </div>
        <RecoveryCode code={recover.data.recoveryCode} />
        <Checkbox
          size="md"
          checked={saved}
          onChange={(event) => setSaved(event.currentTarget.checked)}
          label={t("recovery.code.saved")}
        />
        <Button size="md" fullWidth disabled={!saved} onClick={() => void navigate({ to: "/" })}>
          {t("recovery.code.toApp")}
        </Button>
      </div>
    );
  }

  return (
    <div className={layout.card}>
      <div className={layout.heading}>
        <h1 className={layout.title}>{t("recovery.code.title")}</h1>
        <p className={layout.subtitle}>{t("recovery.code.subtitle")}</p>
      </div>
      {recover.isError && <ServerError error={recover.error} />}
      <form
        className={layout.form}
        noValidate
        onSubmit={form.onSubmit((values) =>
          recover.mutate({
            email: values.email.trim(),
            code: values.code,
            password: values.password,
          }),
        )}
      >
        <TextInput
          size="md"
          label={t("recovery.email")}
          type="email"
          autoComplete="username"
          key={form.key("email")}
          {...form.getInputProps("email")}
          error={form.errors["email"] === undefined ? undefined : t("recovery.emailInvalid")}
        />
        <TextInput
          size="md"
          label={t("recovery.code.code")}
          description={t("recovery.code.codeHint")}
          inputWrapperOrder={["label", "input", "description", "error"]}
          autoComplete="one-time-code"
          spellCheck={false}
          key={form.key("code")}
          {...form.getInputProps("code")}
          error={form.errors["code"] === undefined ? undefined : t("recovery.codeInvalid")}
        />
        <PasswordInput
          size="md"
          label={t("recovery.code.password")}
          autoComplete="new-password"
          visibilityToggleButtonProps={{ "aria-label": t("password.show") }}
          key={form.key("password")}
          {...form.getInputProps("password")}
          error={form.errors["password"] === undefined ? undefined : t("recovery.passwordShort")}
        />
        <PasswordInput
          size="md"
          label={t("recovery.code.repeat")}
          autoComplete="new-password"
          visibilityToggleButtonProps={{ "aria-label": t("password.show") }}
          key={form.key("repeat")}
          {...form.getInputProps("repeat")}
          error={form.errors["repeat"] === undefined ? undefined : t("recovery.mismatch")}
        />
        <Button type="submit" size="md" fullWidth loading={recover.isPending}>
          {t("recovery.code.submit")}
        </Button>
      </form>
      <p className={layout.switch}>
        <Link to="/login">{t("recovery.toLogin")}</Link>
      </p>
    </div>
  );
}
