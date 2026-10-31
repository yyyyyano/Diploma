// «Законы» (ADM-10, LAW-40; Admin.dc.html — Admin--index-building): сводка по базе, расписание проверок (время, ночное окно,
// автообновление, режим новых актов), «Индекс и загрузчик» (прогресс стартового каталога «N из 28», векторный индекс, «Проверить
// сейчас», «Добавить акты вручную», контакт оператора) и разделы: акты, очередь кандидатов, журналы, справочники. Всё считает
// сервер; сайт показывает метаданные общей правовой базы — данных пользователей здесь нет (PRIV-07).
import type { LawsOverview } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import { LocalDate } from "@kosht/kernel";
import { Button, Modal, Switch, Textarea, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { SkeletonCard, StatCard, StatusBadge } from "../../ui/index.ts";
import classes from "./Admin.module.css";
import { LawsSections } from "./LawsSections.tsx";

/** Опрос раз в 2 с, пока идёт загрузка каталога или строятся векторы (как у моделей на первом запуске). */
const POLL_MS = 2000;

export const dayLabel = (day: string): string => formatDate(LocalDate.parse(day));

export function AdminLawsPage() {
  const { t } = useTranslation("admin");
  const overview = useQuery(
    orpc.admin.lawsOverview.queryOptions({
      refetchInterval: (query) => {
        const data = query.state.data;
        const busy =
          data !== undefined &&
          (data.startup.state === "loading" || data.vectors.state === "working");
        return busy ? POLL_MS : false;
      },
    }),
  );
  if (overview.isPending) return <SkeletonCard />;
  if (overview.isError) {
    return (
      <p className={classes.error} role="alert">
        <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
        {t("laws.error")}
      </p>
    );
  }
  const data = overview.data;
  return (
    <>
      <div className={classes.tiles}>
        <StatCard
          title={t("laws.summary.inIndex")}
          value={data.summary.inIndex}
          hint={t("laws.summary.inIndexHint")}
        />
        <StatCard
          title={t("laws.summary.cardOnly")}
          value={data.summary.cardOnly}
          hint={t("laws.summary.cardOnlyHint")}
        />
        <StatCard
          title={t("laws.summary.repealed")}
          value={data.summary.repealed}
          hint={t("laws.summary.repealedHint")}
        />
        <StatCard
          title={t("laws.summary.candidates")}
          value={data.summary.candidates}
          hint={t("laws.summary.candidatesHint")}
        />
      </div>
      <div className={classes.grid}>
        <ScheduleCard overview={data} />
        <LoaderCard overview={data} />
      </div>
      <LawsSections candidates={data.summary.candidates} />
    </>
  );
}

function useStoreOverview() {
  const queryClient = useQueryClient();
  return (next: LawsOverview) => queryClient.setQueryData(orpc.admin.lawsOverview.queryKey(), next);
}

function ErrorLine({ error }: { readonly error: unknown }) {
  const { t } = useTranslation(["admin", "errors"]);
  if (error === null) return null;
  const params = errorParamsOf(error) as Record<string, unknown>;
  const reason = params["reason"];
  const text =
    errorCodeOf(error) === "VALIDATION" && typeof reason === "string"
      ? t(
          `admin:laws.schedule.invalid.${reason === "window-empty" ? "window-empty" : "outside-window"}`,
        )
      : t(`errors:${errorCodeOf(error)}`, errorParamsOf(error));
  return (
    <p className={classes.error} role="alert">
      <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
      {text}
    </p>
  );
}

function ScheduleCard({ overview }: { readonly overview: LawsOverview }) {
  const { t } = useTranslation("admin");
  const store = useStoreOverview();
  const { schedule } = overview;
  const [form, setForm] = useState({
    checkTime: schedule.checkTime,
    windowFrom: schedule.windowFrom,
    windowTo: schedule.windowTo,
  });
  const save = useMutation(orpc.admin.setLawsSettings.mutationOptions({ onSuccess: store }));
  const toggle = useMutation(orpc.admin.setLawsSettings.mutationOptions({ onSuccess: store }));
  const last = schedule.lastCheck;
  return (
    <section className={classes.card} aria-labelledby="admin-laws-schedule">
      <div className={classes.cardHead}>
        <h2 id="admin-laws-schedule" className={classes.cardTitle}>
          {t("laws.schedule.title")}
        </h2>
        <StatusBadge tone={schedule.autoUpdate ? "ok" : "neutral"} icon={CheckCircle2}>
          {schedule.autoUpdate ? t("laws.schedule.on") : t("laws.schedule.off")}
        </StatusBadge>
      </div>
      <dl className={classes.dl}>
        <dt>{t("laws.schedule.last")}</dt>
        <dd>
          {last === null
            ? t("laws.schedule.lastNever")
            : t("laws.schedule.lastAt", { date: dayLabel(last.at.day), time: last.at.time })}
        </dd>
        {last !== null && (
          <>
            <dt>{t("laws.schedule.result")}</dt>
            <dd>
              {last.stopReason !== null
                ? t("laws.schedule.resultStopped", { reason: last.stopReason })
                : last.problems > 0
                  ? t("laws.schedule.resultProblems", {
                      updated: last.updated,
                      problems: last.problems,
                    })
                  : t("laws.schedule.resultOk", { updated: last.updated })}
            </dd>
          </>
        )}
        <dt>{t("laws.schedule.next")}</dt>
        <dd>
          {schedule.nextCheck === null
            ? t("laws.schedule.nextOff")
            : t("laws.schedule.lastAt", {
                date: dayLabel(schedule.nextCheck.day),
                time: schedule.nextCheck.time,
              })}
        </dd>
      </dl>
      <form
        className={classes.card}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(form);
        }}
      >
        <div className={classes.fields}>
          <TextInput
            label={t("laws.schedule.checkTime")}
            type="time"
            value={form.checkTime}
            onChange={(event) => setForm({ ...form, checkTime: event.currentTarget.value })}
          />
          <TextInput
            label={`${t("laws.schedule.window")}: ${t("laws.schedule.from")}`}
            type="time"
            value={form.windowFrom}
            onChange={(event) => setForm({ ...form, windowFrom: event.currentTarget.value })}
          />
          <TextInput
            label={`${t("laws.schedule.window")}: ${t("laws.schedule.to")}`}
            type="time"
            value={form.windowTo}
            onChange={(event) => setForm({ ...form, windowTo: event.currentTarget.value })}
          />
        </div>
        <p className={classes.hint}>{t("laws.schedule.windowHint")}</p>
        <div className={classes.actions}>
          <Button type="submit" loading={save.isPending}>
            {t("laws.schedule.save")}
          </Button>
        </div>
        {save.isSuccess && (
          <output className={classes.ok}>
            <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
            {t("laws.schedule.saved")}
          </output>
        )}
        <ErrorLine error={save.error} />
      </form>
      <Switch
        label={t("laws.schedule.auto")}
        checked={schedule.autoUpdate}
        disabled={toggle.isPending}
        onChange={(event) => toggle.mutate({ autoUpdate: event.currentTarget.checked })}
      />
      <div className={classes.cardHead}>
        <fieldset className={`${classes.segments} ${classes.group}`}>
          <legend className={classes.srOnly}>{t("laws.schedule.newActsLabel")}</legend>
          {(["auto", "suggest"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={classes.segment}
              aria-pressed={overview.newActsMode === mode}
              disabled={toggle.isPending}
              onClick={() => toggle.mutate({ newActsMode: mode })}
            >
              {mode === "auto" ? t("laws.schedule.newActsAuto") : t("laws.schedule.newActsSuggest")}
            </button>
          ))}
        </fieldset>
      </div>
      <ErrorLine error={toggle.error} />
    </section>
  );
}

function LoaderCard({ overview }: { readonly overview: LawsOverview }) {
  const { t } = useTranslation(["admin", "errors"]);
  const queryClient = useQueryClient();
  const store = useStoreOverview();
  const { startup, vectors } = overview;
  const [contact, setContact] = useState(overview.loaderContact);
  const [adding, setAdding] = useState(false);
  const saveContact = useMutation(orpc.admin.setLawsSettings.mutationOptions({ onSuccess: store }));
  const checkNow = useMutation(
    orpc.admin.lawsCheckNow.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() }),
    }),
  );
  const percent = vectors.total === 0 ? 0 : Math.round((vectors.embedded / vectors.total) * 100);
  return (
    <section className={classes.card} aria-labelledby="admin-laws-loader">
      <div className={classes.cardHead}>
        <h2 id="admin-laws-loader" className={classes.cardTitle}>
          {t("laws.loader.title")}
        </h2>
        <p className={classes.hint}>{t("laws.loader.pace")}</p>
      </div>
      {startup.state === "off" ? (
        <p className={classes.hint}>{t("laws.loader.startupOff")}</p>
      ) : startup.state === "waiting" ? (
        <p className={classes.hint}>{t("laws.loader.startupWaiting")}</p>
      ) : (
        <>
          <p className={classes.subTitle}>
            {t("laws.loader.startup", { done: startup.done, total: startup.total })}
          </p>
          {startup.problems > 0 && (
            <p className={classes.hint}>
              {t("laws.loader.startupProblems", { count: startup.problems })}
            </p>
          )}
        </>
      )}
      {startup.state === "stopped" && startup.stopReason !== null && (
        <p className={classes.warn} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`laws.loader.stopped.${startup.stopReason}`)}
        </p>
      )}
      <div>
        <div className={classes.cardHead}>
          <span id="admin-laws-vectors">
            {vectors.model === null
              ? t("laws.loader.vectorsNoModel")
              : t("laws.loader.vectors", { model: vectors.model })}
          </span>
          <span className={classes.count}>{percent}%</span>
        </div>
        <progress
          className={classes.bar}
          aria-labelledby="admin-laws-vectors"
          value={vectors.embedded}
          max={Math.max(vectors.total, 1)}
        />
        <p className={classes.hint}>
          {vectors.state === "waiting-model"
            ? t("laws.loader.vectorsWaiting")
            : vectors.state === "idle"
              ? t("laws.loader.vectorsDone", { total: vectors.total })
              : t("laws.loader.vectorsProgress", {
                  embedded: vectors.embedded,
                  total: vectors.total,
                })}
        </p>
      </div>
      <div className={classes.actions}>
        <Button
          leftSection={<RefreshCw size={16} strokeWidth={1.8} aria-hidden />}
          loading={checkNow.isPending}
          onClick={() => checkNow.mutate({})}
        >
          {t("laws.loader.checkNow")}
        </Button>
        <Button
          variant="default"
          leftSection={<Plus size={16} strokeWidth={1.8} aria-hidden />}
          onClick={() => setAdding(true)}
        >
          {t("laws.loader.addActs")}
        </Button>
      </div>
      {checkNow.isSuccess && (
        <output className={classes.ok}>
          <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
          {t("laws.loader.checkNowSent")}
        </output>
      )}
      {checkNow.isError && (
        <p className={classes.error} role="alert">
          <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
          {t(`errors:${errorCodeOf(checkNow.error)}`, errorParamsOf(checkNow.error))}
        </p>
      )}
      <form
        noValidate
        className={classes.fields}
        onSubmit={(event) => {
          event.preventDefault();
          saveContact.mutate({ loaderContact: contact });
        }}
      >
        <TextInput
          label={t("laws.loader.contact")}
          description={t("laws.loader.contactHint")}
          inputWrapperOrder={["label", "input", "description", "error"]}
          autoComplete="off"
          value={contact}
          onChange={(event) => setContact(event.currentTarget.value)}
        />
        <p className={classes.hint}>
          {t("laws.loader.userAgent")} <span className={classes.mono}>{overview.userAgent}</span>
        </p>
        <div className={classes.actions}>
          <Button type="submit" variant="default" loading={saveContact.isPending}>
            {t("laws.loader.contactSave")}
          </Button>
        </div>
        {saveContact.isSuccess && (
          <output className={classes.ok}>
            <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
            {t("laws.loader.contactSaved")}
          </output>
        )}
        <ErrorLine error={saveContact.error} />
      </form>
      <AddActsDialog opened={adding} onClose={() => setAdding(false)} />
    </section>
  );
}

function AddActsDialog({
  opened,
  onClose,
}: {
  readonly opened: boolean;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation(["admin", "errors"]);
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const add = useMutation(
    orpc.admin.addLawActs.mutationOptions({
      onSuccess: (result) => {
        if (result.accepted > 0) setText("");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
      },
    }),
  );
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return (
    <Modal opened={opened} onClose={onClose} title={t("laws.add.title")} centered>
      <form
        noValidate
        className={classes.fields}
        onSubmit={(event) => {
          event.preventDefault();
          if (lines.length > 0) add.mutate({ links: lines.slice(0, 200) });
        }}
      >
        <p className={classes.hint}>{t("laws.add.hint")}</p>
        <Textarea
          label={t("laws.add.links")}
          autosize
          minRows={4}
          maxRows={10}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        {add.isSuccess && (
          <output className={add.data.accepted > 0 ? classes.ok : classes.warn}>
            {add.data.accepted > 0
              ? t("laws.add.sent", { count: add.data.accepted })
              : t("laws.add.none")}
            {add.data.rejected.length > 0 &&
              ` ${t("laws.add.rejected", { count: add.data.rejected.length })}`}
          </output>
        )}
        {add.isError && (
          <p className={classes.error} role="alert">
            <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
            {t(`errors:${errorCodeOf(add.error)}`, errorParamsOf(add.error))}
          </p>
        )}
        <div className={classes.dialogActions}>
          <Button variant="default" onClick={onClose}>
            {t("laws.add.cancel")}
          </Button>
          <Button type="submit" loading={add.isPending} disabled={lines.length === 0}>
            {t("laws.add.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
