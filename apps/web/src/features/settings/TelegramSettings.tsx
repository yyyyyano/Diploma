// Вкладка «Telegram» (TG-02, PRIV-08, design/screens/Settings.dc.html — Settings--telegram): подключение одной кнопкой с
// отдельным согласием на передачу данных через Telegram. «Подключить» открывает чат с ботом по ссылке со скрытым
// одноразовым кодом — вводить ничего не нужно; пока ждём «Старт», вкладка сама проверяет статус. Отключение — с вопросом.
// Бот не настроен (токена нет) — кнопка неактивна. Статус и ссылка — с сервера (`telegram.status`, `telegram.beginLink`).
import { CONSENT_VERSIONS, formatDate } from "@kosht/i18n";
import { DEFAULT_TIME_ZONE, LocalDate } from "@kosht/kernel";
import { Button, Checkbox, Modal } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Send } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { SkeletonCard } from "../../ui/index.ts";
import classes from "./SettingsPage.module.css";
import { useTelegramTexts } from "./telegram-texts.ts";

/** Как часто вкладка проверяет «Старт», пока ссылка выдана, мс. */
const POLL_MS = 2_500;

const FEATURES = ["receipt", "statement", "voice", "buttons", "commands"] as const;

export function TelegramSettings() {
  useTelegramTexts();
  const { t } = useTranslation(["telegram", "errors", "policy"]);
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const status = useQuery({
    ...orpc.telegram.status.queryOptions(),
    refetchInterval: (query) => (query.state.data?.pending == null ? false : POLL_MS),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.telegram.key() });
  const begin = useMutation(
    orpc.telegram.beginLink.mutationOptions({
      onSuccess: ({ url }) => {
        setLink(url);
        window.open(url, "_blank", "noopener");
        void refresh();
      },
    }),
  );
  const cancel = useMutation(
    orpc.telegram.cancelLink.mutationOptions({
      onSuccess: () => {
        setLink(null);
        void refresh();
      },
    }),
  );
  const unlink = useMutation(
    orpc.telegram.unlink.mutationOptions({
      onSuccess: () => {
        setAsking(false);
        setAgreed(false);
        setLink(null);
        void refresh();
      },
    }),
  );

  if (status.isPending) return <SkeletonCard />;
  if (status.isError) {
    return (
      <p className={classes.error} role="alert">
        <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
        {t("telegram:tab.error")}
      </p>
    );
  }
  const { configured, botName, linked, pending } = status.data;
  const failure = begin.error ?? cancel.error ?? unlink.error;

  return (
    <>
      {linked !== null ? (
        <section className={classes.card} aria-labelledby="settings-telegram">
          <div className={classes.row}>
            <span className={classes.rowIcon}>
              <CheckCircle2 size={20} strokeWidth={1.8} aria-hidden />
            </span>
            <div className={classes.rowText}>
              <h2 id="settings-telegram" className={classes.cardTitle}>
                {t("telegram:tab.connected")}
                {linked.username !== null && ` @${linked.username}`}
              </h2>
              <p className={classes.hint}>
                {t("telegram:tab.since", {
                  date: formatDate(
                    LocalDate.fromInstant(new Date(linked.since), DEFAULT_TIME_ZONE),
                  ),
                })}
              </p>
            </div>
            <Button variant="default" onClick={() => setAsking(true)}>
              {t("telegram:tab.disconnect")}
            </Button>
          </div>
          <p className={classes.hint}>{t("telegram:tab.historyNote")}</p>
          <p className={classes.hint}>{t("telegram:tab.runNote")}</p>
        </section>
      ) : (
        <section className={classes.card} aria-labelledby="settings-telegram">
          <div>
            <h2 id="settings-telegram" className={classes.cardTitle}>
              {t("telegram:tab.title")}
            </h2>
            <p className={classes.hint}>{t("telegram:tab.lead")}</p>
          </div>
          <ul className={classes.list}>
            {FEATURES.map((feature) => (
              <li key={feature}>
                <strong>{t(`telegram:tab.features.${feature}.title`)}</strong>
                {" — "}
                {t(`telegram:tab.features.${feature}.text`)}
              </li>
            ))}
          </ul>
          <p className={classes.banner}>{t("policy:telegram.warning")}</p>
          {!configured && <p className={classes.hint}>{t("telegram:tab.notConfigured")}</p>}
          <Checkbox
            checked={agreed}
            disabled={!configured || pending !== null}
            onChange={(event) => setAgreed(event.currentTarget.checked)}
            label={t("telegram:tab.consent")}
          />
          {pending === null ? (
            <div className={classes.actions}>
              <Button
                leftSection={<Send size={16} strokeWidth={1.8} aria-hidden />}
                disabled={!configured || !agreed}
                loading={begin.isPending}
                onClick={() => begin.mutate({ version: CONSENT_VERSIONS.telegram })}
              >
                {t("telegram:tab.connect")}
              </Button>
              <span className={classes.hint}>
                {agreed ? t("telegram:tab.hintReady") : t("telegram:tab.hintNeedConsent")}
              </span>
            </div>
          ) : (
            <output className={classes.form}>
              <strong>{t("telegram:tab.waiting")}</strong>
              <p className={classes.hint}>{t("telegram:tab.waitingText")}</p>
              <div className={classes.actions}>
                {link !== null && (
                  <Button component="a" href={link} target="_blank" rel="noopener noreferrer">
                    {t("telegram:tab.openBot")}
                  </Button>
                )}
                <Button
                  variant="default"
                  loading={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  {t("telegram:tab.cancel")}
                </Button>
              </div>
            </output>
          )}
          {botName !== null && link === null && pending !== null && (
            <p className={classes.hint}>@{botName}</p>
          )}
        </section>
      )}
      {failure !== null && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`errors:${errorCodeOf(failure)}`, errorParamsOf(failure))}
        </p>
      )}
      <Modal
        opened={asking}
        onClose={() => setAsking(false)}
        title={t("telegram:tab.confirmTitle")}
        centered
        size={480}
        radius="lg"
        closeButtonProps={{ "aria-label": t("telegram:tab.close") }}
      >
        <div className={classes.form}>
          <p className={classes.text}>{t("telegram:tab.confirmText")}</p>
          <p className={classes.hint}>{t("telegram:tab.confirmHint")}</p>
          <div className={classes.dialogActions}>
            <Button variant="default" onClick={() => setAsking(false)}>
              {t("telegram:tab.keep")}
            </Button>
            <Button color="red" loading={unlink.isPending} onClick={() => unlink.mutate()}>
              {t("telegram:tab.disconnect")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
