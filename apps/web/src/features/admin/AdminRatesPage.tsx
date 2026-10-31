// «Таблица ставок» (ADM-11, TAX-03, LAW-33; Admin.dc.html — Admin--rates): параметр → период → значение → источник → кто и когда
// подтвердил. Калькулятор считает только подтверждённое; новое и изменённое значение ждёт «Подтвердить»; пометка «Проверьте» — в новой
// редакции нормы числа не нашлось (значение само не менялось). Числа считает сервер, сайт показывает их и читает ввод. Словарь
// страницы подгружается вместе с ней (не входит в первую загрузку сайта).
import { type RateRow, type RatesTable } from "@kosht/contract";
import { formatDate, formatMoney, formatScaled, parseMoney, ratesTexts } from "@kosht/i18n";
import { LocalDate, Money } from "@kosht/kernel";
import { Button, Modal, Select, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock3, Info } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { SkeletonCard, StatusBadge } from "../../ui/index.ts";
import classes from "./Admin.module.css";

const day = (iso: string): string => formatDate(LocalDate.parse(iso));

type T = ReturnType<typeof useTranslation<["rates", "errors"]>>["t"];
type Unit = RateRow["unit"];

/** Значение словами: деньги — «216,00 BYN», проценты — «13 %»; вычеты ст. 209 — «в месяц». */
function valueText(row: RateRow, t: T): string {
  if (row.unit === "percent-bp") return `${formatScaled(row.value, 2).replace(/,00$/u, "")} %`;
  const money = formatMoney(Money.of(row.value, "BYN"));
  return row.group === "std-deduction" && row.param !== "ndfl.std-deduction.base-income-limit"
    ? t("rates:perMonth", { value: money })
    : money;
}

const PARAM_LABELS: Readonly<Record<string, string>> = ratesTexts.params;
/** Название параметра; код, которого нет в словаре (сервер добавил раньше сайта), показывается как есть. */
const paramLabel = (param: string): string => PARAM_LABELS[param] ?? param;

/** Страница: регистрирует свой словарь в i18next до первого показа текстов. */
export function AdminRatesPage() {
  const { i18n } = useTranslation();
  if (!i18n.hasResourceBundle("ru", "rates")) {
    i18n.addResourceBundle("ru", "rates", ratesTexts, true, true);
  }
  return <RatesView />;
}

function RatesView() {
  const { t } = useTranslation(["rates", "errors"]);
  const table = useQuery(orpc.admin.rates.queryOptions());
  const [editing, setEditing] = useState<Draft | undefined>(undefined);
  if (table.isPending) return <SkeletonCard />;
  if (table.isError) {
    return (
      <p className={classes.error} role="alert">
        <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
        {t("rates:error")}
      </p>
    );
  }
  const data = table.data;
  const current = data.items.filter((r) => r.status !== "superseded");
  const units = new Map<string, Unit>(data.items.map((r) => [r.param, r.unit]));
  const params = [...units.keys()];
  return (
    <>
      <p className={classes.note}>
        <Info size={18} strokeWidth={1.8} aria-hidden />
        {t("rates:note")}
      </p>
      <section className={classes.card} aria-labelledby="admin-rates">
        <div className={classes.cardHead}>
          <h2 id="admin-rates" className={classes.cardTitle}>
            {t("rates:title")}
          </h2>
          <p className={classes.hint}>{t("rates:subtitle")}</p>
        </div>
        <div className={classes.actions}>
          <Button
            variant="default"
            onClick={() => setEditing({ ...BLANK, param: params[0] ?? "" })}
          >
            {t("rates:actions.add")}
          </Button>
        </div>
        {current.length === 0 ? (
          <p className={classes.hint}>{t("rates:empty")}</p>
        ) : (
          <table className={`${classes.table} ${classes.stack}`}>
            <thead>
              <tr>
                <th scope="col">{t("rates:columns.param")}</th>
                <th scope="col">{t("rates:columns.value")}</th>
                <th scope="col">{t("rates:columns.source")}</th>
                <th scope="col">{t("rates:columns.status")}</th>
                <th scope="col">
                  <span className={classes.srOnly}>{t("rates:columns.param")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {current.map((row) => (
                <RateLine key={row.id} row={row} onEdit={() => setEditing(draftOf(row))} />
              ))}
            </tbody>
          </table>
        )}
      </section>
      <History items={data.items} />
      {editing !== undefined && (
        <ProposeDialog
          key={`${editing.param}|${editing.validFrom}`}
          draft={editing}
          units={units}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}

function RateLine({ row, onEdit }: { readonly row: RateRow; readonly onEdit: () => void }) {
  const { t } = useTranslation(["rates", "errors"]);
  const queryClient = useQueryClient();
  const store = (next: RatesTable) => queryClient.setQueryData(orpc.admin.rates.queryKey(), next);
  const confirm = useMutation(orpc.admin.confirmRate.mutationOptions({ onSuccess: store }));
  const reject = useMutation(orpc.admin.rejectRate.mutationOptions({ onSuccess: store }));
  const label = paramLabel(row.param);
  const period =
    row.validTo === null
      ? t("rates:period.open", { from: day(row.validFrom) })
      : t("rates:period.range", { from: day(row.validFrom), to: day(row.validTo) });
  const error = confirm.error ?? reject.error;
  const pending = row.status === "pending";
  return (
    <tr>
      <th scope="row" className={classes.cell}>
        {label}
        <span className={classes.small}>{period}</span>
      </th>
      <td data-label={t("rates:columns.value")} className={classes.mono}>
        <strong>{valueText(row, t)}</strong>
      </td>
      <td data-label={t("rates:columns.source")} className={classes.cell}>
        {row.source.act !== null && row.source.article !== null
          ? row.source.point === null
            ? t("rates:source.article", { act: row.source.act, article: row.source.article })
            : t("rates:source.point", {
                act: row.source.act,
                article: row.source.article,
                point: row.source.point,
              })
          : row.source.url !== null
            ? t("rates:source.url")
            : t("rates:source.none")}
        {row.source.url !== null && (
          <span className={`${classes.small} ${classes.mono}`}>{row.source.url}</span>
        )}
      </td>
      <td data-label={t("rates:columns.status")} className={classes.cell}>
        {pending ? (
          <StatusBadge tone="warn" icon={Clock3}>
            {t("rates:status.pending")}
          </StatusBadge>
        ) : (
          <StatusBadge tone="ok" icon={CheckCircle2}>
            {t("rates:status.confirmed")}
          </StatusBadge>
        )}
        {pending && <span className={classes.small}>{t("rates:pendingHint")}</span>}
        {!pending && row.confirmed !== null && (
          <span className={classes.small}>
            {t(`rates:confirmedBy.${row.confirmed.by}`, { date: day(row.confirmed.on) })}
          </span>
        )}
        {row.drift && (
          <span className={classes.small}>
            <StatusBadge tone="warn" icon={AlertTriangle}>
              {t("rates:drift")}
            </StatusBadge>
          </span>
        )}
        {error !== null && (
          <span className={classes.small} role="alert">
            {errorCodeOf(error) === "CONFLICT"
              ? t("rates:conflict")
              : t(`errors:${errorCodeOf(error)}`, errorParamsOf(error))}
          </span>
        )}
      </td>
      <td>
        <div className={classes.rowActions}>
          {pending && (
            <>
              <Button
                loading={confirm.isPending}
                aria-label={t("rates:actions.confirmLabel", { param: label })}
                onClick={() => confirm.mutate({ id: row.id })}
              >
                {t("rates:actions.confirm")}
              </Button>
              <Button
                variant="default"
                loading={reject.isPending}
                aria-label={t("rates:actions.rejectLabel", { param: label })}
                onClick={() => reject.mutate({ id: row.id })}
              >
                {t("rates:actions.reject")}
              </Button>
            </>
          )}
          {row.drift && !pending && (
            <Button
              loading={confirm.isPending}
              aria-label={t("rates:actions.editLabel", { param: label })}
              onClick={onEdit}
            >
              {t("rates:actions.edit")}
            </Button>
          )}
          {!pending && !row.drift && (
            <Button
              variant="default"
              aria-label={t("rates:actions.editLabel", { param: label })}
              onClick={onEdit}
            >
              {t("rates:actions.edit")}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function History({ items }: { readonly items: RatesTable["items"] }) {
  const { t } = useTranslation(["rates"]);
  const entries = items
    .filter(
      (r) => r.status === "superseded" || (r.status === "confirmed" && r.confirmed?.by === "admin"),
    )
    .toSorted((a, b) => (b.confirmed?.on ?? "").localeCompare(a.confirmed?.on ?? ""));
  return (
    <section className={classes.card} aria-labelledby="admin-rates-history">
      <h2 id="admin-rates-history" className={classes.cardTitle}>
        {t("rates:history.title")}
      </h2>
      {entries.length === 0 ? (
        <p className={classes.hint}>{t("rates:history.empty")}</p>
      ) : (
        <ul className={classes.rows}>
          {entries.map((row) => {
            const date = row.confirmed === null ? "" : day(row.confirmed.on);
            const param = paramLabel(row.param);
            const value = valueText(row, t);
            return (
              <li key={row.id}>
                {row.status === "superseded"
                  ? t("rates:history.superseded", { date, param, value })
                  : t("rates:history.confirmed", {
                      date,
                      param,
                      value,
                      who: t("rates:confirmedBy.admin", { date }),
                    })}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface Draft {
  readonly param: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly value: string;
  readonly sourceAct: string;
  readonly sourceArticle: string;
  readonly sourcePoint: string;
  readonly sourceUrl: string;
}

const BLANK: Draft = {
  param: "",
  validFrom: "",
  validTo: "",
  value: "",
  sourceAct: "",
  sourceArticle: "",
  sourcePoint: "",
  sourceUrl: "",
};

/** Правка — предложение нового значения на тот же период: поля берутся из строки, значение вводится заново. */
function draftOf(row: RateRow): Draft {
  return {
    param: row.param,
    validFrom: row.validFrom,
    validTo: row.validTo ?? "",
    value: formatScaled(row.value, 2).replace(/,00$/u, ""),
    sourceAct: row.source.act ?? "",
    sourceArticle: row.source.article ?? "",
    sourcePoint: row.source.point ?? "",
    sourceUrl: row.source.url ?? "",
  };
}

function ProposeDialog({
  draft,
  units,
  onClose,
}: {
  readonly draft: Draft;
  readonly units: ReadonlyMap<string, Unit>;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation(["rates", "errors"]);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Draft>(draft);
  const [valueInvalid, setValueInvalid] = useState(false);
  const propose = useMutation(
    orpc.admin.proposeRate.mutationOptions({
      onSuccess: (next) => {
        queryClient.setQueryData(orpc.admin.rates.queryKey(), next);
        onClose();
      },
    }),
  );
  const unit = units.get(form.param) ?? "byn-minor";
  const set = (patch: Partial<Draft>) => setForm({ ...form, ...patch });
  const error = propose.error;
  const reason =
    error === null ? undefined : (errorParamsOf(error) as Record<string, unknown>)["reason"];
  const message = valueInvalid
    ? t("rates:form.invalid.value")
    : error === null
      ? null
      : errorCodeOf(error) === "VALIDATION" && typeof reason === "string"
        ? t(
            `rates:form.invalid.${reason === "unknown-param" || reason === "period" || reason === "required" || reason === "format" ? reason : "format"}`,
          )
        : t(`errors:${errorCodeOf(error)}`, errorParamsOf(error));
  return (
    <Modal
      opened
      onClose={onClose}
      centered
      title={draft.value === "" ? t("rates:form.titleNew") : t("rates:form.titleEdit")}
    >
      <form
        noValidate
        className={classes.fields}
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = parseMoney(form.value, "BYN");
          if (parsed === undefined || Number(parsed.minor) < 0) {
            setValueInvalid(true);
            return;
          }
          setValueInvalid(false);
          propose.mutate({
            param: form.param,
            validFrom: form.validFrom,
            validTo: form.validTo === "" ? null : form.validTo,
            value: Number(parsed.minor),
            sourceAct: form.sourceAct === "" ? null : form.sourceAct,
            sourceArticle: form.sourceArticle === "" ? null : form.sourceArticle,
            sourcePoint: form.sourcePoint === "" ? null : form.sourcePoint,
            sourceUrl: form.sourceUrl === "" ? null : form.sourceUrl,
          });
        }}
      >
        <p className={classes.hint}>{t("rates:form.hint")}</p>
        <Select
          label={t("rates:form.param")}
          allowDeselect={false}
          data={[...units.keys()].map((p) => ({ value: p, label: paramLabel(p) }))}
          value={form.param === "" ? null : form.param}
          onChange={(value) => set({ param: value ?? "" })}
        />
        <TextInput
          label={t("rates:form.validFrom")}
          type="date"
          value={form.validFrom}
          onChange={(e) => set({ validFrom: e.currentTarget.value })}
        />
        <TextInput
          label={t("rates:form.validTo")}
          type="date"
          value={form.validTo}
          onChange={(e) => set({ validTo: e.currentTarget.value })}
        />
        <TextInput
          label={unit === "percent-bp" ? t("rates:form.valuePercent") : t("rates:form.valueMoney")}
          inputMode="decimal"
          autoComplete="off"
          value={form.value}
          onChange={(e) => set({ value: e.currentTarget.value })}
        />
        <TextInput
          label={t("rates:form.sourceAct")}
          autoComplete="off"
          value={form.sourceAct}
          onChange={(e) => set({ sourceAct: e.currentTarget.value })}
        />
        <TextInput
          label={t("rates:form.sourceArticle")}
          autoComplete="off"
          value={form.sourceArticle}
          onChange={(e) => set({ sourceArticle: e.currentTarget.value })}
        />
        <TextInput
          label={t("rates:form.sourcePoint")}
          autoComplete="off"
          value={form.sourcePoint}
          onChange={(e) => set({ sourcePoint: e.currentTarget.value })}
        />
        <TextInput
          label={t("rates:form.sourceUrl")}
          type="url"
          autoComplete="off"
          value={form.sourceUrl}
          onChange={(e) => set({ sourceUrl: e.currentTarget.value })}
        />
        {message !== null && (
          <p className={classes.error} role="alert">
            <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
            {message}
          </p>
        )}
        <div className={classes.dialogActions}>
          <Button variant="default" onClick={onClose}>
            {t("rates:form.cancel")}
          </Button>
          <Button type="submit" loading={propose.isPending}>
            {t("rates:form.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
