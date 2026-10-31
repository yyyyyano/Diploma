// Разделы вкладки «Законы» (LAW-40): список актов с состояниями и кнопками, очередь кандидатов «Добавить / Отклонить», журнал
// обновлений, журнал запросов загрузчика, справочники. Переключатель разделов — кнопки с aria-pressed (панель одна на странице,
// отдельных адресов у разделов нет).
import type { LawAdminAct, LawAdminStatus, LawCandidate } from "@kosht/contract";
import { Button } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  History,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { ConfirmDialog, SkeletonCard, StatusBadge, type StatusTone } from "../../ui/index.ts";
import classes from "./Admin.module.css";
import { DictionaryEditor } from "./DictionaryEditor.tsx";

const SECTIONS = ["acts", "candidates", "updates", "fetches", "dictionaries"] as const;
type Section = (typeof SECTIONS)[number];

export function LawsSections({ candidates }: { readonly candidates: number }) {
  const { t } = useTranslation("admin");
  const [section, setSection] = useState<Section>("acts");
  return (
    <section className={classes.card} aria-label={t("laws.sections.label")}>
      <fieldset className={`${classes.segments} ${classes.group}`}>
        <legend className={classes.srOnly}>{t("laws.sections.label")}</legend>
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            className={classes.segment}
            aria-pressed={section === id}
            onClick={() => setSection(id)}
          >
            {t(`laws.sections.${id}`)}
            {id === "candidates" && candidates > 0 && (
              <span className={classes.count}>&nbsp;{candidates}</span>
            )}
          </button>
        ))}
      </fieldset>
      {section === "acts" && <ActsSection />}
      {section === "candidates" && <CandidatesSection />}
      {section === "updates" && <UpdatesSection />}
      {section === "fetches" && <FetchesSection />}
      {section === "dictionaries" && <DictionaryEditor />}
    </section>
  );
}

function Failure({ error }: { readonly error: unknown }) {
  const { t } = useTranslation("errors");
  if (error === null || error === undefined) return null;
  return (
    <p className={classes.error} role="alert">
      <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
      {t(errorCodeOf(error), errorParamsOf(error))}
    </p>
  );
}

const STATUS_VIEW: Readonly<Record<LawAdminStatus, { tone: StatusTone; icon: typeof Clock3 }>> = {
  active: { tone: "ok", icon: CheckCircle2 },
  "has-changes": { tone: "brand", icon: Clock3 },
  "card-only": { tone: "neutral", icon: FileText },
  repealed: { tone: "neutral", icon: XCircle },
  quarantined: { tone: "warn", icon: AlertTriangle },
  failed: { tone: "danger", icon: AlertCircle },
  pending: { tone: "neutral", icon: Clock3 },
};

const STATUSES: readonly LawAdminStatus[] = [
  "active",
  "has-changes",
  "card-only",
  "repealed",
  "quarantined",
  "failed",
  "pending",
];

function ActsSection() {
  const { t } = useTranslation(["admin", "laws"]);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LawAdminStatus | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [excluding, setExcluding] = useState<LawAdminAct | undefined>(undefined);
  const acts = useQuery(
    orpc.admin.lawsActs.queryOptions({
      input: { page, ...(status === undefined ? {} : { status }) },
    }),
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
  const checkText = useMutation(orpc.admin.lawsCheckText.mutationOptions({ onSuccess: refresh }));
  const exclude = useMutation(
    orpc.admin.excludeLawAct.mutationOptions({
      onSuccess: async () => {
        setExcluding(undefined);
        await refresh();
      },
    }),
  );
  if (acts.isPending) return <SkeletonCard />;
  if (acts.isError) return <Failure error={acts.error} />;
  const data = acts.data;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pick = (next: LawAdminStatus | undefined) => {
    setStatus(next);
    setPage(1);
  };
  return (
    <>
      <fieldset className={`${classes.pills} ${classes.group}`}>
        <legend className={classes.srOnly}>{t("admin:laws.acts.filters")}</legend>
        <button
          type="button"
          className={classes.pill}
          aria-pressed={status === undefined}
          onClick={() => pick(undefined)}
        >
          {t("admin:laws.acts.all")} <span className={classes.count}>{data.counts.all}</span>
        </button>
        {STATUSES.filter((s) => data.counts[s] > 0).map((s) => (
          <button
            key={s}
            type="button"
            className={classes.pill}
            aria-pressed={status === s}
            onClick={() => pick(s)}
          >
            {t(`admin:laws.acts.statuses.${s}`)}{" "}
            <span className={classes.count}>{data.counts[s]}</span>
          </button>
        ))}
      </fieldset>
      {data.items.length === 0 ? (
        <p className={classes.hint}>{t("admin:laws.acts.empty")}</p>
      ) : (
        <table className={`${classes.table} ${classes.stack}`}>
          <thead>
            <tr>
              <th scope="col">{t("admin:laws.acts.act")}</th>
              <th scope="col">{t("admin:laws.acts.topic")}</th>
              <th scope="col">{t("admin:laws.acts.status")}</th>
              <th scope="col">{t("admin:laws.acts.edition")}</th>
              <th scope="col">{t("admin:laws.acts.checked")}</th>
              <th scope="col">
                <span className={classes.srOnly}>{t("admin:laws.acts.act")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((act) => (
              <ActRow
                key={act.pravoId}
                act={act}
                onCheckText={() => checkText.mutate({ pravoId: act.pravoId })}
                onExclude={() => setExcluding(act)}
              />
            ))}
          </tbody>
        </table>
      )}
      <div className={classes.pager}>
        <p className={classes.hint}>
          {t("admin:laws.acts.shown", { shown: data.items.length, total: data.total })}
        </p>
        {pages > 1 && (
          <div className={classes.actions}>
            <Button variant="default" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t("admin:laws.acts.prev")}
            </Button>
            <span className={classes.hint}>{t("admin:laws.acts.page", { page, pages })}</span>
            <Button variant="default" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t("admin:laws.acts.next")}
            </Button>
          </div>
        )}
      </div>
      {checkText.isSuccess && (
        <output className={classes.ok}>
          <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
          {t("admin:laws.acts.checkTextSent")}
        </output>
      )}
      <Failure error={checkText.error ?? exclude.error} />
      <ConfirmDialog
        opened={excluding !== undefined}
        title={t("admin:laws.acts.excludeTitle")}
        confirmLabel={t("admin:laws.acts.excludeConfirm")}
        tone="danger"
        pending={exclude.isPending}
        onConfirm={() => excluding !== undefined && exclude.mutate({ pravoId: excluding.pravoId })}
        onCancel={() => setExcluding(undefined)}
      >
        {excluding !== undefined && (
          <p>{t("admin:laws.acts.excludeText", { title: excluding.title })}</p>
        )}
      </ConfirmDialog>
    </>
  );
}

function ActRow({
  act,
  onCheckText,
  onExclude,
}: {
  readonly act: LawAdminAct;
  readonly onCheckText: () => void;
  readonly onExclude: () => void;
}) {
  const { t } = useTranslation(["admin", "laws"]);
  const view = STATUS_VIEW[act.status];
  const note =
    act.status === "has-changes"
      ? t("admin:laws.acts.notes.has-changes", { count: act.pendingChanges })
      : act.status === "repealed"
        ? t("admin:laws.acts.notes.repealed", { date: act.repealedOn ?? "" })
        : t(`admin:laws.acts.notes.${act.status}`, { defaultValue: "" });
  const problem =
    act.problem === null
      ? ""
      : ` (${t(`admin:laws.acts.problems.${act.problem}`, { defaultValue: act.problem })})`;
  return (
    <tr>
      <th scope="row" className={classes.cell}>
        {act.title}
        <span className={`${classes.small} ${classes.mono}`}>{act.pravoId}</span>
      </th>
      <td data-label={t("admin:laws.acts.topic")}>
        {act.topic === null
          ? t("admin:laws.acts.none")
          : t(`laws:groups.${act.topic}`, { defaultValue: act.topic })}
      </td>
      <td data-label={t("admin:laws.acts.status")}>
        <StatusBadge tone={view.tone} icon={view.icon}>
          {t(`admin:laws.acts.statuses.${act.status}`)}
        </StatusBadge>
        {note !== "" && (
          <span className={classes.small}>
            {note}
            {problem}
          </span>
        )}
      </td>
      <td data-label={t("admin:laws.acts.edition")} className={classes.mono}>
        {act.editionOn ?? t("admin:laws.acts.none")}
      </td>
      <td data-label={t("admin:laws.acts.checked")} className={classes.mono}>
        {act.checkedOn ?? t("admin:laws.acts.none")}
      </td>
      <td>
        <div className={classes.rowActions}>
          {act.status === "card-only" && (
            <Button
              variant="default"
              aria-label={t("admin:laws.acts.checkTextLabel", { title: act.title })}
              onClick={onCheckText}
            >
              {t("admin:laws.acts.checkText")}
            </Button>
          )}
          <Button
            variant="default"
            aria-label={t("admin:laws.acts.excludeLabel", { title: act.title })}
            onClick={onExclude}
          >
            {t("admin:laws.acts.exclude")}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function CandidatesSection() {
  const { t } = useTranslation(["admin", "laws"]);
  const queryClient = useQueryClient();
  const list = useQuery(orpc.admin.lawsCandidates.queryOptions());
  const decide = useMutation(
    orpc.admin.decideLawCandidate.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() }),
    }),
  );
  if (list.isPending) return <SkeletonCard />;
  if (list.isError) return <Failure error={list.error} />;
  return (
    <>
      <p className={classes.hint}>{t("admin:laws.candidates.hint")}</p>
      {list.data.items.length === 0 ? (
        <p className={classes.hint}>{t("admin:laws.candidates.empty")}</p>
      ) : (
        <table className={`${classes.table} ${classes.stack}`}>
          <thead>
            <tr>
              <th scope="col">{t("admin:laws.acts.act")}</th>
              <th scope="col">{t("admin:laws.acts.status")}</th>
              <th scope="col">
                <span className={classes.srOnly}>{t("admin:laws.acts.act")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((c) => (
              <CandidateRow
                key={c.id}
                candidate={c}
                busy={decide.isPending}
                onDecide={(decision) => decide.mutate({ id: c.id, decision })}
              />
            ))}
          </tbody>
        </table>
      )}
      <Failure error={decide.error} />
    </>
  );
}

function CandidateRow({
  candidate,
  busy,
  onDecide,
}: {
  readonly candidate: LawCandidate;
  readonly busy: boolean;
  readonly onDecide: (decision: "add" | "reject") => void;
}) {
  const { t } = useTranslation("admin");
  const title = candidate.title ?? t("laws.candidates.untitled");
  return (
    <tr>
      <th scope="row" className={classes.cell}>
        {title}
        <span className={`${classes.small} ${classes.mono}`}>{candidate.pravoId}</span>
      </th>
      <td data-label={t("laws.acts.status")}>
        {t(`laws.candidates.sources.${candidate.source}`)}
        {candidate.reason !== null && (
          <span className={classes.small}>
            {t(`laws.candidates.reasons.${candidate.reason}`, { defaultValue: candidate.reason })}
            {candidate.hasText !== null &&
              ` · ${candidate.hasText ? t("laws.candidates.hasText") : t("laws.candidates.noText")}`}
          </span>
        )}
      </td>
      <td>
        <div className={classes.rowActions}>
          <Button
            disabled={busy}
            aria-label={t("laws.candidates.addLabel", { title })}
            onClick={() => onDecide("add")}
          >
            {t("laws.candidates.add")}
          </Button>
          <Button
            variant="default"
            disabled={busy}
            aria-label={t("laws.candidates.rejectLabel", { title })}
            onClick={() => onDecide("reject")}
          >
            {t("laws.candidates.reject")}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function UpdatesSection() {
  const { t } = useTranslation("admin");
  const log = useQuery(orpc.admin.lawsUpdates.queryOptions());
  if (log.isPending) return <SkeletonCard />;
  if (log.isError) return <Failure error={log.error} />;
  if (log.data.items.length === 0) return <p className={classes.hint}>{t("laws.updates.empty")}</p>;
  return (
    <table className={`${classes.table} ${classes.stack}`}>
      <thead>
        <tr>
          <th scope="col">{t("laws.updates.when")}</th>
          <th scope="col">{t("laws.updates.what")}</th>
        </tr>
      </thead>
      <tbody>
        {log.data.items.map((entry, index) => (
          <tr key={`${entry.at.day}-${entry.at.time}-${entry.event}-${String(index)}`}>
            <th scope="row" className={classes.mono}>
              {entry.at.day} {entry.at.time}
            </th>
            <td data-label={t("laws.updates.what")} className={classes.cell}>
              <StatusBadge tone="neutral" icon={History}>
                {t(`laws.updates.events.${entry.event}`, {
                  defaultValue: t("laws.updates.unknownEvent", { event: entry.event }),
                })}
              </StatusBadge>
              {entry.title !== null && <span className={classes.small}>{entry.title}</span>}
              {entry.pravoId !== null && entry.title === null && (
                <span className={`${classes.small} ${classes.mono}`}>{entry.pravoId}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FetchesSection() {
  const { t } = useTranslation("admin");
  const log = useQuery(orpc.admin.lawsFetches.queryOptions());
  if (log.isPending) return <SkeletonCard />;
  if (log.isError) return <Failure error={log.error} />;
  if (log.data.items.length === 0) return <p className={classes.hint}>{t("laws.fetches.empty")}</p>;
  return (
    <table className={`${classes.table} ${classes.stack}`}>
      <thead>
        <tr>
          <th scope="col">{t("laws.fetches.when")}</th>
          <th scope="col">{t("laws.fetches.url")}</th>
          <th scope="col">{t("laws.fetches.code")}</th>
          <th scope="col">{t("laws.fetches.size")}</th>
          <th scope="col">{t("laws.fetches.time")}</th>
        </tr>
      </thead>
      <tbody>
        {log.data.items.map((entry, index) => (
          <tr key={`${entry.at.day}-${entry.at.time}-${String(index)}`}>
            <th scope="row" className={classes.mono}>
              {entry.at.day} {entry.at.time}
            </th>
            <td data-label={t("laws.fetches.url")} className={`${classes.mono} ${classes.cell}`}>
              {entry.url}
            </td>
            <td data-label={t("laws.fetches.code")} className={classes.mono}>
              {entry.httpStatus ?? entry.outcome}
            </td>
            <td data-label={t("laws.fetches.size")} className={classes.mono}>
              {entry.bytes ?? "—"}
            </td>
            <td data-label={t("laws.fetches.time")} className={classes.mono}>
              {entry.ms === null ? "—" : t("laws.fetches.ms", { ms: entry.ms })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
