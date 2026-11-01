// «Система» (ADM-60, NFR-22, NFR-23, NFR-24, OBS-05, OBS-07; Admin.dc.html — Admin--system): фоновые задачи (что
// выполняется, расписания с последним запуском, последние ошибки — только журнал), почта (поля только для записи,
// тестовое письмо — на адрес администратора), часовой пояс (экран говорит, что расписания перейдут на него после
// перезапуска), доступ с других устройств и адрес для ссылок, Langfuse. Токен бота — T-052, демо-данные — T-054.
import type { JobRun, SystemOverview } from "@kosht/contract";
import { formatRelativeDay } from "@kosht/i18n";
import { DEFAULT_TIME_ZONE, LocalDate } from "@kosht/kernel";
import {
  Anchor,
  Button,
  Checkbox,
  NumberInput,
  PasswordInput,
  Select,
  Switch,
  TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock3, Mail, MinusCircle, Send } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { SkeletonCard, StatusBadge, type StatusTone } from "../../ui/index.ts";
import classes from "./Admin.module.css";

/** День запуска относительно сегодня («сегодня», «вчера», дата): формата времени суток в @kosht/i18n нет. */
function dayOf(iso: string): string {
  const day = (instant: Date) => LocalDate.fromInstant(instant, DEFAULT_TIME_ZONE);
  return formatRelativeDay(day(new Date(iso)), day(new Date()));
}

const TONES: Readonly<Record<JobRun["status"], StatusTone>> = {
  running: "brand",
  completed: "ok",
  failed: "danger",
  dropped: "warn",
};

/** Пояса IANA для выбора; без Intl.supportedValuesOf (старые браузеры) — хотя бы текущий. */
function timeZones(current: string): string[] {
  const all =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return all.includes(current) ? all : [current, ...all];
}

export function AdminSystemPage() {
  const { t } = useTranslation("admin");
  const system = useQuery(orpc.admin.system.queryOptions());
  if (system.isPending) return <SkeletonCard />;
  if (system.isError) {
    return (
      <p className={classes.error} role="alert">
        <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
        {t("system.error")}
      </p>
    );
  }
  return (
    <>
      <JobsCard jobs={system.data.jobs} />
      <div className={classes.grid}>
        <MailCard mail={system.data.mail} />
        <TimeCard overview={system.data} />
      </div>
      <TelegramCard telegram={system.data.telegram} />
    </>
  );
}

function RunState({ run }: { readonly run: JobRun }) {
  const { t } = useTranslation("admin");
  const label = t(`system.jobs.statuses.${run.status}`);
  return (
    <StatusBadge tone={TONES[run.status]} icon={run.status === "completed" ? CheckCircle2 : Clock3}>
      {run.status === "running" && run.progress !== null
        ? `${label} · ${t("system.jobs.progress", { percent: run.progress })}`
        : label}
    </StatusBadge>
  );
}

function JobsCard({ jobs }: { readonly jobs: SystemOverview["jobs"] }) {
  const { t } = useTranslation("admin");
  return (
    <section className={classes.card} aria-labelledby="admin-jobs">
      <div className={classes.cardHead}>
        <h2 id="admin-jobs" className={classes.cardTitle}>
          {t("system.jobs.title")}
        </h2>
        <p className={classes.hint}>{t("system.jobs.hint")}</p>
      </div>

      <h3 className={classes.subTitle}>{t("system.jobs.running")}</h3>
      {jobs.running.length === 0 ? (
        <p className={classes.hint}>{t("system.jobs.noRunning")}</p>
      ) : (
        <table className={`${classes.table} ${classes.stack}`}>
          <thead>
            <tr>
              <th scope="col">{t("system.jobs.task")}</th>
              <th scope="col">{t("system.jobs.when")}</th>
              <th scope="col">{t("system.jobs.state")}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.running.map((run) => (
              <tr key={`${run.kind}-${run.startedAt}`}>
                <th scope="row" className={classes.mono}>
                  {run.kind}
                </th>
                <td data-label={t("system.jobs.when")}>{dayOf(run.startedAt)}</td>
                <td data-label={t("system.jobs.state")}>
                  <RunState run={run} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className={classes.subTitle}>{t("system.jobs.schedules")}</h3>
      {jobs.schedules.length === 0 ? (
        <p className={classes.hint}>{t("system.jobs.noSchedules")}</p>
      ) : (
        <table className={`${classes.table} ${classes.stack}`}>
          <thead>
            <tr>
              <th scope="col">{t("system.jobs.task")}</th>
              <th scope="col">{t("system.jobs.cron")}</th>
              <th scope="col">{t("system.jobs.lastRun")}</th>
              <th scope="col">{t("system.jobs.state")}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.schedules.map((schedule) => (
              <tr key={schedule.name}>
                <th scope="row" className={classes.mono}>
                  {schedule.name}
                </th>
                <td data-label={t("system.jobs.cron")} className={classes.mono}>
                  {schedule.cron}
                </td>
                <td data-label={t("system.jobs.lastRun")}>
                  {schedule.lastRun === null
                    ? t("system.jobs.never")
                    : dayOf(schedule.lastRun.startedAt)}
                </td>
                <td data-label={t("system.jobs.state")}>
                  {schedule.lastRun !== null && <RunState run={schedule.lastRun} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className={classes.subTitle}>{t("system.jobs.failures")}</h3>
      {jobs.failures.length === 0 ? (
        <p className={classes.hint}>{t("system.jobs.noFailures")}</p>
      ) : (
        <table className={`${classes.table} ${classes.stack}`}>
          <thead>
            <tr>
              <th scope="col">{t("system.jobs.task")}</th>
              <th scope="col">{t("system.jobs.when")}</th>
              <th scope="col">{t("system.jobs.state")}</th>
              <th scope="col">{t("system.jobs.code")}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.failures.map((run) => (
              <tr key={`${run.kind}-${run.startedAt}`}>
                <th scope="row" className={classes.mono}>
                  {run.kind}
                </th>
                <td data-label={t("system.jobs.when")}>{dayOf(run.startedAt)}</td>
                <td data-label={t("system.jobs.state")}>
                  <RunState run={run} />
                </td>
                <td data-label={t("system.jobs.code")} className={classes.mono}>
                  {run.errorCode}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Токен Telegram-бота (ADM-60, NFR-16): поле только для записи — значение после сохранения не показывается. */
const TELEGRAM_TOKEN_SHAPE = /^\d{3,20}:[A-Za-z0-9_-]{20,100}$/u;

function TelegramCard({ telegram }: { readonly telegram: SystemOverview["telegram"] }) {
  const { t } = useTranslation(["admin", "errors"]);
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const save = useMutation(
    orpc.admin.setTelegramToken.mutationOptions({
      onSuccess: (next) => {
        queryClient.setQueryData(orpc.admin.system.queryKey(), next);
        setToken("");
      },
    }),
  );
  const trimmed = token.trim();
  const invalid = trimmed !== "" && !TELEGRAM_TOKEN_SHAPE.test(trimmed);
  return (
    <section className={classes.card} aria-labelledby="admin-telegram">
      <div className={classes.cardHead}>
        <h2 id="admin-telegram" className={classes.cardTitle}>
          {t("admin:system.telegram.title")}
        </h2>
        {telegram.token === "set" ? (
          <StatusBadge tone="ok" icon={CheckCircle2}>
            {t("admin:system.telegram.set")}
          </StatusBadge>
        ) : (
          <StatusBadge tone="warn" icon={MinusCircle}>
            {t(`admin:system.telegram.${telegram.token}`)}
          </StatusBadge>
        )}
      </div>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed !== "" && !invalid) save.mutate({ token: trimmed });
        }}
      >
        <PasswordInput
          label={t("admin:system.telegram.token")}
          description={t("admin:system.telegram.tokenHint")}
          autoComplete="off"
          placeholder={
            telegram.token === "set"
              ? t("admin:system.telegram.placeholderSet")
              : t("admin:system.telegram.placeholderUnset")
          }
          value={token}
          error={invalid ? t("admin:system.telegram.invalid") : undefined}
          onChange={(event) => setToken(event.currentTarget.value)}
        />
        <div className={classes.actions}>
          <Button type="submit" disabled={trimmed === "" || invalid} loading={save.isPending}>
            {t("admin:system.telegram.save")}
          </Button>
          <Button
            variant="default"
            disabled={telegram.token === "unset"}
            loading={save.isPending}
            onClick={() => save.mutate({ token: null })}
          >
            {t("admin:system.telegram.clear")}
          </Button>
        </div>
      </form>
      {save.isSuccess && (
        <output className={classes.ok}>
          <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
          {t(
            save.variables.token === null
              ? "admin:system.telegram.cleared"
              : "admin:system.telegram.saved",
          )}
        </output>
      )}
      {save.isError && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`errors:${errorCodeOf(save.error)}`, errorParamsOf(save.error))}
        </p>
      )}
    </section>
  );
}

function MailCard({ mail }: { readonly mail: SystemOverview["mail"] }) {
  const { t } = useTranslation(["admin", "errors"]);
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    host: mail.host,
    port: mail.port,
    secure: mail.secure,
    user: mail.user,
    from: mail.from,
    password: "",
  });
  const save = useMutation(
    orpc.admin.setMail.mutationOptions({
      onSuccess: (next) => {
        queryClient.setQueryData(orpc.admin.system.queryKey(), next);
        setForm((current) => ({ ...current, password: "" }));
      },
    }),
  );
  const test = useMutation(orpc.admin.sendTestMail.mutationOptions());
  const error = save.error ?? test.error;
  return (
    <section className={classes.card} aria-labelledby="admin-mail">
      <div className={classes.cardHead}>
        <h2 id="admin-mail" className={classes.cardTitle}>
          {t("admin:system.mail.title")}
        </h2>
        {mail.configured ? (
          <StatusBadge tone="ok" icon={CheckCircle2}>
            {t("admin:system.mail.configured")}
          </StatusBadge>
        ) : (
          <StatusBadge tone="warn" icon={MinusCircle}>
            {t("admin:system.mail.notConfigured")}
          </StatusBadge>
        )}
      </div>
      {!mail.configured && (
        <p className={classes.note}>
          <Mail size={18} strokeWidth={1.8} aria-hidden />
          {t("admin:system.mail.mailboxNote")}
        </p>
      )}
      <form
        className={classes.card}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const { password, ...fields } = form;
          save.mutate(password === "" ? fields : { ...fields, password });
        }}
      >
        <div className={classes.fields}>
          <TextInput
            label={t("admin:system.mail.host")}
            description={t("admin:system.mail.hostHint")}
            inputWrapperOrder={["label", "input", "description", "error"]}
            value={form.host}
            onChange={(event) => setForm({ ...form, host: event.currentTarget.value })}
          />
          <NumberInput
            label={t("admin:system.mail.port")}
            min={1}
            max={65_535}
            value={form.port}
            onChange={(value) => setForm({ ...form, port: Number(value) })}
          />
          <TextInput
            label={t("admin:system.mail.user")}
            autoComplete="off"
            value={form.user}
            onChange={(event) => setForm({ ...form, user: event.currentTarget.value })}
          />
          <PasswordInput
            label={t("admin:system.mail.password")}
            autoComplete="new-password"
            placeholder={
              mail.passwordSet
                ? t("admin:system.mail.passwordSet")
                : t("admin:system.mail.passwordUnset")
            }
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
          />
          <TextInput
            label={t("admin:system.mail.from")}
            type="email"
            value={form.from}
            onChange={(event) => setForm({ ...form, from: event.currentTarget.value })}
          />
        </div>
        <Checkbox
          label={t("admin:system.mail.secure")}
          checked={form.secure}
          onChange={(event) => setForm({ ...form, secure: event.currentTarget.checked })}
        />
        <div className={classes.actions}>
          <Button type="submit" loading={save.isPending}>
            {t("admin:system.mail.save")}
          </Button>
          <Button
            variant="default"
            leftSection={<Send size={16} strokeWidth={1.8} aria-hidden />}
            loading={test.isPending}
            onClick={() => test.mutate({})}
          >
            {t("admin:system.mail.test")}
          </Button>
        </div>
      </form>
      {save.isSuccess && (
        <output className={classes.ok}>
          <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
          {t("admin:system.mail.saved")}
        </output>
      )}
      {test.isSuccess && (
        <output className={classes.ok}>
          <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
          {t("admin:system.mail.tested")}
        </output>
      )}
      {error !== null && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`errors:${errorCodeOf(error)}`, errorParamsOf(error))}
        </p>
      )}
    </section>
  );
}

function TimeCard({ overview }: { readonly overview: SystemOverview }) {
  const { t } = useTranslation(["admin", "errors"]);
  const queryClient = useQueryClient();
  const [address, setAddress] = useState(overview.lan.address);
  const update = (next: SystemOverview) =>
    queryClient.setQueryData(orpc.admin.system.queryKey(), next);
  const zone = useMutation(orpc.admin.setTimeZone.mutationOptions({ onSuccess: update }));
  const lan = useMutation(orpc.admin.setLan.mutationOptions({ onSuccess: update }));
  const error = zone.error ?? lan.error;
  return (
    <section className={classes.card} aria-labelledby="admin-time">
      <h2 id="admin-time" className={classes.cardTitle}>
        {t("admin:system.time.title")}
      </h2>
      <Select
        label={t("admin:system.time.zone")}
        description={t("admin:system.time.zoneHint")}
        inputWrapperOrder={["label", "input", "description", "error"]}
        data={timeZones(overview.timeZone)}
        value={overview.timeZone}
        searchable
        allowDeselect={false}
        onChange={(value) => {
          if (value !== null && value !== overview.timeZone) zone.mutate({ timeZone: value });
        }}
      />
      <Switch
        label={t("admin:system.time.lan")}
        description={
          overview.lan.allowed ? t("admin:system.time.lanOn") : t("admin:system.time.lanOff")
        }
        checked={overview.lan.allowed}
        onChange={(event) => lan.mutate({ allowed: event.currentTarget.checked, address })}
      />
      <TextInput
        label={t("admin:system.time.address")}
        description={t("admin:system.time.addressHint")}
        inputWrapperOrder={["label", "input", "description", "error"]}
        value={address}
        onChange={(event) => setAddress(event.currentTarget.value)}
      />
      <div className={classes.actions}>
        <Button
          variant="default"
          loading={lan.isPending}
          onClick={() => lan.mutate({ allowed: overview.lan.allowed, address })}
        >
          {t("admin:system.time.lanSave")}
        </Button>
      </div>
      {(zone.isSuccess || lan.isSuccess) && (
        <output className={classes.ok}>
          <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
          {zone.isSuccess ? t("admin:system.time.zoneSaved") : t("admin:system.time.lanSaved")}
        </output>
      )}
      {error !== null && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`errors:${errorCodeOf(error)}`, errorParamsOf(error))}
        </p>
      )}
      <div className={classes.cardHead}>
        <h3 className={classes.subTitle}>{t("admin:system.time.langfuse")}</h3>
        {overview.langfuse.enabled ? (
          <StatusBadge tone="ok" icon={CheckCircle2}>
            {t("admin:system.time.langfuseOn")}
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral" icon={MinusCircle}>
            {t("admin:system.time.langfuseOff")}
          </StatusBadge>
        )}
      </div>
      {overview.langfuse.url !== null && (
        <p className={classes.hint}>
          <Anchor href={overview.langfuse.url} target="_blank" rel="noreferrer">
            {t("admin:system.time.langfuseOpen")}
          </Anchor>{" "}
          {t("admin:system.time.langfuseHint")}
        </p>
      )}
    </section>
  );
}
