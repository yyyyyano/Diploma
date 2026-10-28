// Вкладка «Конфиденциальность» (PRIV-02, design/screens/Settings.dc.html — Settings--privacy): облачное согласие —
// дать (окно с текстом согласия и отметкой «прочитал(а)»: решение информированное, версия текста уходит на сервер) и
// отозвать (сразу, без окна: отзыв — одиночное действие, а вернуть облако можно тем же переключателем); пример
// маскирования; история решений с версией текста. Числа и решения — с сервера (`privacy.state`).
import { type ConsentRecord, type PrivacyState } from "@kosht/contract";
import { CONSENT_VERSIONS, formatDate } from "@kosht/i18n";
import { DEFAULT_TIME_ZONE, LocalDate } from "@kosht/kernel";
import { Button, Checkbox, Modal, Switch } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Lock,
  MinusCircle,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { SkeletonCard, StatusBadge } from "../../ui/index.ts";
import classes from "./SettingsPage.module.css";

const dayOf = (iso: string) => formatDate(LocalDate.fromInstant(new Date(iso), DEFAULT_TIME_ZONE));

export function PrivacySettings() {
  const { t } = useTranslation("settings");
  const state = useQuery(orpc.privacy.state.queryOptions());
  if (state.isPending) return <SkeletonCard />;
  if (state.isError) {
    return (
      <p className={classes.error} role="alert">
        <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
        {t("privacy.error")}
      </p>
    );
  }
  return (
    <>
      <CloudCard state={state.data} />
      <MaskingCard />
      <HistoryCard history={state.data.history} />
    </>
  );
}

function CloudCard({ state }: { readonly state: PrivacyState }) {
  const { t } = useTranslation(["settings", "errors", "policy"]);
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const save = useMutation(
    orpc.privacy.setCloudConsent.mutationOptions({
      onSuccess: (next) => {
        queryClient.setQueryData(orpc.privacy.state.queryKey(), next);
        setAsking(false);
      },
    }),
  );
  const { granted, since } = state.cloud;
  const Icon: LucideIcon = granted ? Cpu : Lock;
  return (
    <section className={classes.card} aria-labelledby="settings-cloud">
      <div className={classes.row}>
        <span className={classes.rowIcon}>
          <Icon size={20} strokeWidth={1.8} aria-hidden />
        </span>
        <div className={classes.rowText}>
          <div className={classes.titleLine}>
            <h2 id="settings-cloud" className={classes.cardTitle}>
              {granted && since !== null
                ? t("settings:privacy.cloud.onTitle", { date: dayOf(since) })
                : t("settings:privacy.cloud.offTitle")}
            </h2>
            <StatusBadge tone={granted ? "brand" : "neutral"} icon={granted ? Cpu : Lock}>
              {granted ? t("settings:privacy.cloud.onBadge") : t("settings:privacy.cloud.offBadge")}
            </StatusBadge>
          </div>
          <p className={classes.hint}>
            {granted ? t("settings:privacy.cloud.onText") : t("settings:privacy.cloud.offText")}
          </p>
        </div>
        <Switch
          checked={granted}
          disabled={save.isPending}
          aria-label={t("settings:privacy.cloud.toggle")}
          onChange={(event) => {
            if (event.currentTarget.checked) {
              setAgreed(false);
              setAsking(true);
            } else {
              save.mutate({ granted: false, version: CONSENT_VERSIONS.cloud });
            }
          }}
        />
      </div>
      <p className={classes.banner}>
        <ShieldCheck size={18} strokeWidth={1.8} aria-hidden />
        {t("settings:privacy.cloud.note")}
      </p>
      {save.isSuccess && !asking && (
        <output className={classes.ok}>
          <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
          {save.data.cloud.granted
            ? t("settings:privacy.cloud.granted")
            : t("settings:privacy.cloud.revoked")}
        </output>
      )}
      {save.isError && !asking && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`errors:${errorCodeOf(save.error)}`, errorParamsOf(save.error))}
        </p>
      )}
      <Modal
        opened={asking}
        onClose={() => setAsking(false)}
        title={t("settings:privacy.consent.title")}
        centered
        size={560}
        radius="lg"
        closeButtonProps={{ "aria-label": t("settings:privacy.consent.later") }}
      >
        <div className={classes.form}>
          <p className={classes.hint}>
            {t("settings:privacy.consent.intro", {
              date: formatDate(LocalDate.parse(CONSENT_VERSIONS.cloud)),
            })}
          </p>
          <p className={classes.text}>{t("policy:cloud.warning")}</p>
          <p className={classes.text}>{t("settings:privacy.consent.rights")}</p>
          <Checkbox
            checked={agreed}
            onChange={(event) => setAgreed(event.currentTarget.checked)}
            label={t("settings:privacy.consent.agree")}
          />
          {save.isError && (
            <p className={classes.error} role="alert">
              <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
              {t(`errors:${errorCodeOf(save.error)}`, errorParamsOf(save.error))}
            </p>
          )}
          <div className={classes.dialogActions}>
            <Button variant="default" onClick={() => setAsking(false)}>
              {t("settings:privacy.consent.later")}
            </Button>
            <Button
              disabled={!agreed}
              loading={save.isPending}
              onClick={() => save.mutate({ granted: true, version: CONSENT_VERSIONS.cloud })}
            >
              {t("settings:privacy.consent.submit")}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function MaskingCard() {
  const { t } = useTranslation("settings");
  return (
    <section className={classes.card} aria-labelledby="settings-masking">
      <div>
        <h2 id="settings-masking" className={classes.cardTitle}>
          {t("privacy.masking.title")}
        </h2>
        <p className={classes.hint}>{t("privacy.masking.text")}</p>
      </div>
      <div className={classes.maskGrid}>
        <div className={classes.maskBox}>
          <span className={classes.eyebrow}>{t("privacy.masking.yours")}</span>
          <p className={classes.text}>{t("privacy.masking.example")}</p>
        </div>
        <div className={classes.maskBox}>
          <span className={classes.eyebrow}>{t("privacy.masking.sent")}</span>
          <p className={classes.text}>{t("privacy.masking.masked")}</p>
        </div>
      </div>
      <p className={classes.hint}>{t("privacy.masking.note")}</p>
    </section>
  );
}

function HistoryCard({ history }: { readonly history: readonly ConsentRecord[] }) {
  const { t } = useTranslation("settings");
  return (
    <section className={classes.card} aria-labelledby="settings-history">
      <div className={classes.cardHead}>
        <h2 id="settings-history" className={classes.cardTitle}>
          {t("privacy.history.title")}
        </h2>
        <Link className={classes.link} to="/policy">
          {t("privacy.history.policy")}
        </Link>
      </div>
      {history.length === 0 ? (
        <p className={classes.hint}>{t("privacy.history.empty")}</p>
      ) : (
        // Версия текста — подписью под видом согласия: таблица в три колонки помещается в 390 px без прокрутки.
        <table className={`${classes.matrix} ${classes.history}`}>
          <thead>
            <tr>
              <th scope="col">{t("privacy.history.kind")}</th>
              <th scope="col">{t("privacy.history.date")}</th>
              <th scope="col">{t("privacy.history.status")}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((record) => (
              <tr key={record.id}>
                <th scope="row">
                  <span className={classes.kindTitle}>
                    {t(`privacy.history.kinds.${record.kind}`)}
                  </span>
                  <span className={classes.hint}>
                    {t("privacy.history.version", {
                      date: formatDate(LocalDate.parse(record.textVersion)),
                    })}
                  </span>
                </th>
                <td>{dayOf(record.at)}</td>
                <td>
                  {record.granted ? (
                    <StatusBadge tone="ok" icon={CheckCircle2}>
                      {t("privacy.history.given")}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral" icon={MinusCircle}>
                      {t("privacy.history.notGiven")}
                    </StatusBadge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
