// Настройки пользователя (design/screens/Settings.dc.html): вкладка «Профиль и вход». Сейчас — карточка почты
// (AUTH-03): адрес, «Подтверждён» или «Не подтверждён» с пояснением, «Отправить письмо ещё раз» и ссылка на
// локальный ящик, пока почта не настроена. Пароль, код восстановления, «Где вы вошли» — T-013; остальные вкладки
// («Конфиденциальность», «Уведомления», «Мои данные», Telegram) появятся с задачами своих модулей.
import { Button, Tabs } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { EmptyState, PageHeader, SkeletonCard, StatusBadge } from "../../ui/index.ts";
import classes from "./SettingsPage.module.css";

export function SettingsPage() {
  const { t } = useTranslation("settings");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className={classes.body}>
        <Tabs defaultValue="profile" keepMounted={false}>
          <Tabs.List aria-label={t("tabs.label")}>
            <Tabs.Tab value="profile">{t("tabs.profile")}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="profile" className={classes.panel}>
            <EmailCard />
          </Tabs.Panel>
        </Tabs>
      </div>
    </>
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
