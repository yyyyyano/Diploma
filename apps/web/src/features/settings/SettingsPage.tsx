// Настройки пользователя (design/screens/Settings.dc.html): вкладка «Профиль и вход» — почта (AUTH-03: «Подтверждён» /
// «Не подтверждён», «Отправить письмо ещё раз», ссылка на локальный ящик), смена пароля (AUTH-08: другие сеансы
// завершаются), код восстановления (AUTH-05: создать, показать один раз) и выход; «Конфиденциальность»
// (`PrivacySettings`, PRIV-02), «Уведомления» (`NotificationSettings`, NOTIF-04), «Мои данные» (`MyDataSettings`,
// PRIV-05/06). Вкладка Telegram — задача бота (T-052).
import { ChangePasswordInput } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import { DEFAULT_TIME_ZONE, LocalDate } from "@kosht/kernel";
import { Button, PasswordInput, Tabs } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  LogOut,
  Mail,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { RecoveryCode } from "../../entities/recovery-code/index.ts";
import { SETTINGS_TABS, type SettingsSearch } from "./model/search.ts";
import { MyDataSettings } from "./MyDataSettings.tsx";
import { NotificationSettings } from "./NotificationSettings.tsx";
import { PrivacySettings } from "./PrivacySettings.tsx";
import { TelegramSettings } from "./TelegramSettings.tsx";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { EmptyState, PageHeader, SkeletonCard, StatusBadge } from "../../ui/index.ts";
import classes from "./SettingsPage.module.css";

export function SettingsPage({ search }: { readonly search: SettingsSearch }) {
  const { t } = useTranslation(["settings", "notifications"]);
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title={t("settings:title")} subtitle={t("settings:subtitle")} />
      <div className={classes.body}>
        <Tabs
          value={search.tab ?? "profile"}
          onChange={(tab) => {
            const next = SETTINGS_TABS.find((known) => known === tab);
            if (next !== undefined) void navigate({ to: "/settings", search: { tab: next } });
          }}
          keepMounted={false}
        >
          <Tabs.List aria-label={t("settings:tabs.label")}>
            <Tabs.Tab value="profile">{t("settings:tabs.profile")}</Tabs.Tab>
            <Tabs.Tab value="privacy">{t("settings:tabs.privacy")}</Tabs.Tab>
            <Tabs.Tab value="telegram">{t("settings:tabs.telegram")}</Tabs.Tab>
            <Tabs.Tab value="notifications">{t("notifications:preferences.tab")}</Tabs.Tab>
            <Tabs.Tab value="my-data">{t("settings:tabs.myData")}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="profile" className={classes.panel}>
            <AdminResetNotice />
            <EmailCard />
            <PasswordCard />
            <RecoveryCodeCard />
            <SignOutCard />
          </Tabs.Panel>
          <Tabs.Panel value="privacy" className={classes.panel}>
            <PrivacySettings />
          </Tabs.Panel>
          <Tabs.Panel value="telegram" className={classes.panel}>
            <TelegramSettings />
          </Tabs.Panel>
          <Tabs.Panel value="notifications" className={classes.panel}>
            <NotificationSettings />
          </Tabs.Panel>
          <Tabs.Panel value="my-data" className={classes.panel}>
            <MyDataSettings />
          </Tabs.Panel>
        </Tabs>
      </div>
    </>
  );
}

/**
 * AUTH-05, R37: «Пароль был сброшен администратором <дата>» — ссылку показали администратору, потому что почта не
 * подтверждена. Видна, пока человек не нажмёт «Понятно» (отметка гасится на сервере).
 */
function AdminResetNotice() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const notice = useQuery(orpc.identity.adminResetNotice.queryOptions());
  const dismiss = useMutation(
    orpc.identity.acknowledgeAdminReset.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: orpc.identity.adminResetNotice.key() }),
    }),
  );
  const at = notice.data?.at ?? null;
  if (at === null) return null;
  return (
    <div className={classes.warnNote}>
      <KeyRound size={20} strokeWidth={1.8} aria-hidden />
      <div className={classes.rowText}>
        <p className={classes.address}>
          {t("adminReset.title", {
            date: formatDate(LocalDate.fromInstant(new Date(at), DEFAULT_TIME_ZONE)),
          })}
        </p>
        <p className={classes.text}>{t("adminReset.text")}</p>
      </div>
      <Button variant="default" loading={dismiss.isPending} onClick={() => dismiss.mutate({})}>
        {t("adminReset.dismiss")}
      </Button>
    </div>
  );
}

function EmailCard() {
  const { t } = useTranslation(["settings", "errors"]);
  const queryClient = useQueryClient();
  const me = useQuery(orpc.identity.me.queryOptions());
  const mail = useQuery(orpc.mail.status.queryOptions());
  const resend = useMutation(
    orpc.identity.resendVerification.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.identity.me.key() }),
    }),
  );

  if (me.isPending) return <SkeletonCard />;
  if (me.isError) {
    return (
      <EmptyState
        tone="error"
        icon={AlertTriangle}
        title={t("settings:error.title")}
        description={t("settings:error.text")}
        actions={<Button onClick={() => void me.refetch()}>{t("settings:error.retry")}</Button>}
      />
    );
  }
  const user = me.data;
  return (
    <section className={classes.card} aria-labelledby="settings-email">
      <h2 id="settings-email" className={classes.cardTitle}>
        {t("settings:email.title")}
      </h2>
      <div className={classes.row}>
        <span className={classes.rowIcon}>
          <Mail size={20} strokeWidth={1.8} aria-hidden />
        </span>
        <div className={classes.rowText}>
          <p className={classes.address}>{user.email}</p>
          <p className={classes.hint}>{t("settings:email.hint")}</p>
        </div>
        {user.emailVerified ? (
          <StatusBadge tone="ok" icon={CheckCircle2}>
            {t("settings:email.verified")}
          </StatusBadge>
        ) : (
          <StatusBadge tone="warn" icon={AlertTriangle}>
            {t("settings:email.unverified")}
          </StatusBadge>
        )}
      </div>
      {!user.emailVerified && (
        <>
          <p className={classes.text}>{t("settings:email.unverifiedText")}</p>
          <div className={classes.actions}>
            <Button
              variant="default"
              leftSection={<Mail size={16} strokeWidth={1.8} aria-hidden />}
              loading={resend.isPending}
              onClick={() => resend.mutate({})}
            >
              {t("settings:email.resend")}
            </Button>
            {mail.data?.mailboxAvailable === true && (
              <Link className={classes.link} to="/mailbox">
                {t("settings:email.mailbox")}
                <ChevronRight size={16} strokeWidth={1.8} aria-hidden />
              </Link>
            )}
          </div>
          {resend.isSuccess && (
            <output className={classes.ok}>
              <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
              {t("settings:email.sent")}
            </output>
          )}
          {resend.isError && (
            <p className={classes.error} role="alert">
              <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
              {t(`errors:${errorCodeOf(resend.error)}`, errorParamsOf(resend.error))}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Форма смены пароля: вход контракта и совпадение повтора (AUTH-08, SEC-01). */
const PasswordForm = ChangePasswordInput.extend({ repeat: z.string() }).refine(
  (v) => v.repeat === v.newPassword,
  { path: ["repeat"] },
);

function PasswordCard() {
  const { t } = useTranslation(["settings", "errors", "auth"]);
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { currentPassword: "", newPassword: "", repeat: "" },
    validate: schemaResolver(PasswordForm, { sync: true }),
  });
  const change = useMutation(
    orpc.identity.changePassword.mutationOptions({ onSuccess: () => form.reset() }),
  );
  return (
    <section className={classes.card} aria-labelledby="settings-password">
      <div>
        <h2 id="settings-password" className={classes.cardTitle}>
          {t("settings:password.title")}
        </h2>
        <p className={classes.hint}>{t("settings:password.hint")}</p>
      </div>
      <form
        className={classes.form}
        noValidate
        onSubmit={form.onSubmit(({ currentPassword, newPassword }) =>
          change.mutate({ currentPassword, newPassword }),
        )}
      >
        <div className={classes.fields}>
          <PasswordInput
            label={t("settings:password.current")}
            autoComplete="current-password"
            visibilityToggleButtonProps={{ "aria-label": t("auth:password.show") }}
            key={form.key("currentPassword")}
            {...form.getInputProps("currentPassword")}
          />
          <PasswordInput
            label={t("settings:password.next")}
            description={t("settings:password.nextHint")}
            inputWrapperOrder={["label", "input", "description", "error"]}
            autoComplete="new-password"
            visibilityToggleButtonProps={{ "aria-label": t("auth:password.show") }}
            key={form.key("newPassword")}
            {...form.getInputProps("newPassword")}
            error={
              form.errors["newPassword"] === undefined ? undefined : t("settings:password.short")
            }
          />
          <PasswordInput
            label={t("settings:password.repeat")}
            autoComplete="new-password"
            visibilityToggleButtonProps={{ "aria-label": t("auth:password.show") }}
            key={form.key("repeat")}
            {...form.getInputProps("repeat")}
            error={
              form.errors["repeat"] === undefined ? undefined : t("settings:password.mismatch")
            }
          />
        </div>
        <div className={classes.actions}>
          <Button type="submit" loading={change.isPending}>
            {t("settings:password.submit")}
          </Button>
        </div>
      </form>
      {change.isSuccess && (
        <output className={classes.ok}>
          <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
          {t("settings:password.done")}
        </output>
      )}
      {change.isError && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`errors:${errorCodeOf(change.error)}`, errorParamsOf(change.error))}
        </p>
      )}
    </section>
  );
}

function RecoveryCodeCard() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const status = useQuery(orpc.identity.recoveryCodeStatus.queryOptions());
  const [shown, setShown] = useState<string | undefined>();
  const create = useMutation(
    orpc.identity.createRecoveryCode.mutationOptions({
      onSuccess: async (result) => {
        setShown(result.recoveryCode);
        await queryClient.invalidateQueries({ queryKey: orpc.identity.recoveryCodeStatus.key() });
      },
    }),
  );
  const createdAt = status.data?.createdAt ?? null;
  return (
    <section className={classes.card} aria-labelledby="settings-recovery">
      <div className={classes.row}>
        <span className={classes.rowIcon}>
          <KeyRound size={20} strokeWidth={1.8} aria-hidden />
        </span>
        <div className={classes.rowText}>
          <h2 id="settings-recovery" className={classes.cardTitle}>
            {t("recovery.title")}
          </h2>
          <p className={classes.hint}>{t("recovery.hint")}</p>
        </div>
      </div>
      {shown === undefined ? (
        <div className={classes.actions}>
          <Button
            variant="default"
            leftSection={<Plus size={16} strokeWidth={1.8} aria-hidden />}
            loading={create.isPending}
            onClick={() => create.mutate({})}
          >
            {createdAt === null ? t("recovery.create") : t("recovery.createNew")}
          </Button>
          <span className={classes.hint}>
            {createdAt === null
              ? t("recovery.none")
              : t("recovery.created", {
                  date: formatDate(LocalDate.fromInstant(new Date(createdAt), DEFAULT_TIME_ZONE)),
                })}
          </span>
        </div>
      ) : (
        <>
          <RecoveryCode code={shown} />
          <p className={classes.hint}>{t("recovery.shownHint")}</p>
          <div className={classes.actions}>
            <Button onClick={() => setShown(undefined)}>{t("recovery.saved")}</Button>
          </div>
        </>
      )}
      {createdAt !== null && shown === undefined && (
        <p className={classes.hint}>{t("recovery.replaceHint")}</p>
      )}
    </section>
  );
}

function SignOutCard() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation(
    orpc.identity.signOut.mutationOptions({
      // Данные пользователя не должны мелькнуть следующему (frontend-feature.md): кэш — целиком.
      onSettled: async () => {
        queryClient.clear();
        await navigate({ to: "/login" });
      },
    }),
  );
  return (
    <section className={classes.card} aria-labelledby="settings-session">
      <div>
        <h2 id="settings-session" className={classes.cardTitle}>
          {t("session.title")}
        </h2>
        <p className={classes.hint}>{t("session.hint")}</p>
      </div>
      <div className={classes.actions}>
        <Button
          variant="default"
          leftSection={<LogOut size={16} strokeWidth={1.8} aria-hidden />}
          loading={signOut.isPending}
          onClick={() => signOut.mutate({})}
        >
          {t("session.signOut")}
        </Button>
      </div>
    </section>
  );
}
