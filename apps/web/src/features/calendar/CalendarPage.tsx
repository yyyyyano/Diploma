// «Календарь» (design/screens/Calendar.dc.html; CAL-01, CAL-03, CAL-04, CAL-06, CAL-07, REC-03, DES-16): месяц сеткой и список
// «Ближайшие» — налоги, гарантии, страховки, свои события и платежи по истории. Карточка события — «Откуда это событие»,
// напоминания, связанные объекты; своё событие добавляется формой или словами ассистенту, удаление — только решением «Да/Нет».
// Суммы и итоги приходят с сервера с traceId (P1, P2). Четыре состояния: загрузка, пусто, ошибка, данные.
import {
  CALENDAR_TYPES,
  CreateEventInput,
  REMIND_DAYS,
  type CalendarEntry,
  type CalendarMonthView,
  type CalendarUpcoming,
  type CreatableType,
  type RemindDays,
} from "@kosht/contract";
import { formatDate, formatMoney, formatMoneyParts, parseMoney } from "@kosht/i18n";
import { LocalDate, type TraceId } from "@kosht/kernel";
import { Button, Checkbox, Modal, Select, Stack, TextInput, VisuallyHidden } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Info,
  Plus,
  Trash2,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { DecisionDialog, UndoActionToast } from "../../entities/action/index.ts";
import {
  cellLabel,
  dayParts,
  EventBadge,
  EventRow,
  eventTitle,
  fullDate,
  monthGenitive,
  originText,
  relativeText,
  useCalendarTexts,
  weekdayName,
  type CalendarT,
} from "../../entities/calendar-event/index.ts";
import { ExplanationSheet } from "../../entities/explanation/index.ts";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { EmptyState, Money, PageHeader, Sheet, SkeletonCard, WhyButton } from "../../ui/index.ts";
import classes from "./CalendarPage.module.css";
import { buildCells, shiftMonth } from "./model/grid.ts";
import type { CalendarSearch } from "./model/search.ts";
import { PropertyBanner } from "./PropertyBanner.tsx";

type Toast = { readonly token: string; readonly message: string };

/** Подпись суммы в ячейке без кода валюты: «−15,99», «+1 440», «≈ −186,40». */
function shortAmount(entry: CalendarEntry): string {
  if (entry.amount === null) return "";
  const { amount } = formatMoneyParts(entry.amount);
  const sign = entry.direction === "in" ? "+" : "−";
  return `${entry.approx ? "≈" : ""}${sign}${amount.replace(/,00$/u, "")}`;
}

export function CalendarPage({ search }: { readonly search: CalendarSearch }) {
  useCalendarTexts();
  const { t } = useTranslation(["calendar", "notifications", "decisions", "errors", "common"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const view = search.view ?? "month";
  const monthQuery = useQuery({
    ...orpc.calendar.month.queryOptions({
      input: search.month === undefined ? {} : { month: search.month },
    }),
    enabled: view === "month",
  });
  const listQuery = useQuery({
    ...orpc.calendar.upcoming.queryOptions(),
    enabled: view === "list",
  });
  const data = view === "month" ? monthQuery.data : listQuery.data;
  const pending = view === "month" ? monthQuery.isPending : listQuery.isPending;
  const failed = view === "month" ? monthQuery.isError : listQuery.isError;
  const [day, setDay] = useState<LocalDate | null>(null);
  const [adding, setAdding] = useState<{ on: string } | null>(null);
  const [trace, setTrace] = useState<TraceId | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const entries: readonly CalendarEntry[] =
    data === undefined
      ? []
      : "groups" in data
        ? data.groups.flatMap((g) => g.entries)
        : data.entries;
  const today = data?.today ?? null;
  const open = search.event === undefined ? undefined : entries.find((e) => e.id === search.event);

  const go = (patch: Partial<CalendarSearch>) =>
    void navigate({ to: "/calendar", search: { ...search, ...patch } });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.calendar.key() });
  const requestDelete = useMutation(
    orpc.calendar.requestDelete.mutationOptions({
      onSuccess: ({ decisionId: id }) => setDecisionId(id),
      onError: (error) => setNotice(t(`errors:${errorCodeOf(error)}`, errorParamsOf(error))),
    }),
  );

  return (
    <>
      <PageHeader
        title={t("calendar:title")}
        subtitle={t("calendar:subtitle")}
        actions={
          <>
            <fieldset className={classes.views}>
              <VisuallyHidden component="legend">{t("calendar:view.label")}</VisuallyHidden>
              {(["month", "list"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={classes.view}
                  aria-pressed={view === kind}
                  onClick={() => go({ view: kind === "month" ? undefined : kind })}
                >
                  {t(`calendar:view.${kind}`)}
                </button>
              ))}
            </fieldset>
            <Button
              leftSection={<Plus size={18} aria-hidden />}
              onClick={() => setAdding({ on: today ?? "" })}
            >
              {t("calendar:add")}
            </Button>
          </>
        }
      />
      <div className={classes.body}>
        {pending && (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}
        {failed && (
          <EmptyState
            tone="error"
            icon={AlertTriangle}
            title={t("calendar:error.title")}
            description={t("calendar:error.text")}
            actions={
              <Button onClick={() => void (view === "month" ? monthQuery : listQuery).refetch()}>
                {t("calendar:error.retry")}
              </Button>
            }
          />
        )}
        <PropertyBanner
          onAnswered={(token, message) => setToast({ token, message })}
          onError={setNotice}
        />
        {notice !== null && (
          <p className={classes.error} role="alert">
            <AlertTriangle size={18} aria-hidden />
            {notice}
          </p>
        )}
        {view === "month" && monthQuery.data !== undefined && (
          <MonthView
            data={monthQuery.data}
            t={t}
            onShift={(delta) => go({ month: shiftMonth(monthQuery.data.month, delta) })}
            onToday={() => go({ month: undefined })}
            onDay={setDay}
            onOpen={(id) => go({ event: id })}
            onWhy={setTrace}
          />
        )}
        {view === "list" && listQuery.data !== undefined && (
          <ListView
            data={listQuery.data}
            t={t}
            onOpen={(id) => go({ event: id })}
            onWhy={setTrace}
            onAdd={() => setAdding({ on: listQuery.data.today })}
          />
        )}
        {data !== undefined && (
          <>
            <p className={classes.hint}>
              <Info size={16} aria-hidden />
              {t("calendar:hint")}
            </p>
            <ul className={classes.legend} aria-label={t("calendar:legend")}>
              {CALENDAR_TYPES.map((type) => (
                <li key={type} className={classes.legendItem}>
                  <EventBadge type={type} />
                  {t(`calendar:types.${type}`)}
                </li>
              ))}
            </ul>
            <p className={classes.note}>{t("calendar:remindNote")}</p>
          </>
        )}
      </div>

      {day !== null && today !== null && (
        <Sheet opened onClose={() => setDay(null)} title={dayTitle(t, day)}>
          <div className={classes.sheetBody}>
            {entries.filter((e) => e.on === day).length === 0 && (
              <p className={classes.muted}>{t("calendar:day.empty")}</p>
            )}
            {entries
              .filter((e) => e.on === day)
              .map((entry) => (
                <EventRow
                  key={entry.id}
                  entry={entry}
                  today={today}
                  showDate={false}
                  onOpen={() => {
                    setDay(null);
                    go({ event: entry.id });
                  }}
                />
              ))}
            <Button
              variant="default"
              leftSection={<Plus size={16} aria-hidden />}
              onClick={() => {
                setAdding({ on: day });
                setDay(null);
              }}
            >
              {t("calendar:day.addForDay")}
            </Button>
          </div>
        </Sheet>
      )}

      {open !== undefined && today !== null && (
        <EventSheet
          entry={open}
          today={today}
          t={t}
          onClose={() => go({ event: undefined })}
          onWhy={setTrace}
          onDelete={() => requestDelete.mutate({ id: open.id as never })}
          deleting={requestDelete.isPending}
          onChanged={(token, message) => {
            setToast({ token, message });
            refresh();
          }}
        />
      )}

      {adding !== null && (
        <AddDialog
          initialDay={adding.on}
          t={t}
          today={today}
          onClose={() => setAdding(null)}
          onCreated={(entry, token) => {
            setAdding(null);
            refresh();
            if (
              entry.on !== null &&
              view === "month" &&
              !entry.on.startsWith(monthQuery.data?.month ?? "")
            ) {
              go({ month: entry.on.slice(0, 7) });
            }
            setToast({
              token,
              message: t("calendar:toast.created", {
                title: eventTitle(t, entry),
                date: entry.on === null ? "" : formatDate(entry.on),
              }),
            });
          }}
        />
      )}

      {decisionId !== null && (
        <DecisionDialog
          decisionId={decisionId}
          opened
          confirmLabel={t("calendar:event.delete")}
          onClose={() => setDecisionId(null)}
          onAnswered={(status, token) => {
            setDecisionId(null);
            if (status !== "yes") return;
            go({ event: undefined });
            refresh();
            if (token !== null) {
              setToast({
                token,
                message: t("calendar:toast.deleted", { title: open?.title ?? "" }),
              });
            }
          }}
        />
      )}

      {trace !== null && <ExplanationSheet traceId={trace} opened onClose={() => setTrace(null)} />}
      {toast !== null && (
        <UndoActionToast
          key={toast.token}
          token={toast.token}
          message={toast.message}
          opened
          onClose={() => setToast(null)}
          onResult={(result) => {
            setToast(null);
            refresh();
            setNotice(result.ok ? null : t("calendar:toast.undoFailed"));
          }}
        />
      )}
    </>
  );
}

function dayTitle(t: CalendarT, day: LocalDate): string {
  const { day: number, month } = dayParts(day);
  return `${weekdayName(t, day)}, ${String(number)} ${monthGenitive(t, month)}`;
}

function Totals({
  totals,
  t,
  onWhy,
}: {
  readonly totals: CalendarMonthView["totals"];
  readonly t: CalendarT;
  readonly onWhy: (trace: TraceId) => void;
}) {
  return (
    <>
      {totals.payments !== null && (
        <span className={classes.stat}>
          {t("calendar:stats.payments")}{" "}
          <Money value={totals.payments.amount} kind="expense" tabular />
          <WhyButton
            subject={t("calendar:stats.paymentsWhy")}
            onClick={() => onWhy(totals.payments?.traceId as TraceId)}
          />
        </span>
      )}
      {totals.income !== null && (
        <span className={classes.stat}>
          {t("calendar:stats.income")} <Money value={totals.income.amount} kind="income" tabular />
          <WhyButton
            subject={t("calendar:stats.incomeWhy")}
            onClick={() => onWhy(totals.income?.traceId as TraceId)}
          />
        </span>
      )}
    </>
  );
}

function MonthView({
  data,
  t,
  onShift,
  onToday,
  onDay,
  onOpen,
  onWhy,
}: {
  readonly data: CalendarMonthView;
  readonly t: CalendarT;
  readonly onShift: (delta: -1 | 1) => void;
  readonly onToday: () => void;
  readonly onDay: (day: LocalDate) => void;
  readonly onOpen: (id: string) => void;
  readonly onWhy: (trace: TraceId) => void;
}) {
  const cells = buildCells(data.month, data.from, data.to, data.entries);
  const [year = "", number = "01"] = data.month.split("-");
  const label = `${t(`calendar:monthNames.${number}` as never) as string} ${year}`;
  return (
    <section className={classes.monthView} aria-label={label}>
      <div className={classes.bar}>
        <nav className={classes.nav} aria-label={label}>
          <button
            type="button"
            className={classes.navButton}
            aria-label={t("calendar:prevMonth")}
            onClick={() => onShift(-1)}
          >
            <ChevronLeft size={20} aria-hidden />
          </button>
          <span className={classes.monthLabel} aria-live="polite">
            {label}
          </span>
          <button
            type="button"
            className={classes.navButton}
            aria-label={t("calendar:nextMonth")}
            onClick={() => onShift(1)}
          >
            <ChevronRight size={20} aria-hidden />
          </button>
          <Button variant="subtle" size="compact-sm" onClick={onToday}>
            {t("calendar:today")}
          </Button>
        </nav>
        <div className={classes.stats}>
          <span>
            {t("calendar:stats.inMonth", { month: t(`calendar:monthIn.${number}` as never) })}
          </span>
          <Totals totals={data.totals} t={t} onWhy={onWhy} />
        </div>
      </div>
      <div className={classes.board}>
        <div className={classes.weekdays} aria-hidden="true">
          {(t("calendar:weekdays", { returnObjects: true }) as unknown as string[]).map(
            (name, i) => (
              <span key={name} className={classes.weekday} data-weekend={i >= 5}>
                {name}
              </span>
            ),
          )}
        </div>
        <div className={classes.grid}>
          {cells.map((cell) => {
            const shown = cell.entries.slice(0, 3);
            const isToday = cell.on === data.today;
            const label = cellLabel(t, cell.on);
            return (
              <div
                key={cell.on}
                className={classes.cell}
                data-out={!cell.inMonth}
                data-today={isToday}
              >
                <button
                  type="button"
                  className={classes.dayNumber}
                  aria-label={
                    cell.entries.length === 0
                      ? t("calendar:cell.none", {
                          label: isToday ? t("calendar:cell.today", { label }) : label,
                        })
                      : t("calendar:cell.count", {
                          label: isToday ? t("calendar:cell.today", { label }) : label,
                          count: cell.entries.length,
                        })
                  }
                  onClick={() => onDay(cell.on)}
                >
                  {dayParts(cell.on).day}
                </button>
                {shown.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={classes.pill}
                    data-type={entry.type}
                    data-past={cell.on < data.today}
                    aria-label={`${eventTitle(t, entry)}, ${formatDate(cell.on)}${
                      entry.amount === null ? "" : `, ${formatMoney(entry.amount)}`
                    }${cell.on < data.today ? `, ${t("calendar:past")}` : ""}`}
                    onClick={() => (entry.stored ? onOpen(entry.id) : onOpen(entry.id))}
                  >
                    <span className={classes.pillTitle} aria-hidden="true">
                      {eventTitle(t, entry)}
                    </span>
                    <span className={classes.pillAmount} aria-hidden="true">
                      {shortAmount(entry)}
                    </span>
                  </button>
                ))}
                {cell.entries.length > 3 && (
                  <button type="button" className={classes.more} onClick={() => onDay(cell.on)}>
                    {t("calendar:more", { count: cell.entries.length - 3 })}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ListView({
  data,
  t,
  onOpen,
  onWhy,
  onAdd,
}: {
  readonly data: CalendarUpcoming;
  readonly t: CalendarT;
  readonly onOpen: (id: string) => void;
  readonly onWhy: (trace: TraceId) => void;
  readonly onAdd: () => void;
}) {
  if (data.groups.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title={t("calendar:empty.title")}
        description={t("calendar:empty.text")}
        actions={<Button onClick={onAdd}>{t("calendar:add")}</Button>}
      />
    );
  }
  return (
    <div className={classes.groups}>
      {data.groups.map((group) => {
        const range = (day: LocalDate | null) => {
          if (day === null) return "";
          const { day: number, month } = dayParts(day);
          return `${String(number)} ${monthGenitive(t, month)}`;
        };
        const title = group.key.startsWith("month-")
          ? t("calendar:groups.month", {
              month: t(`calendar:monthNames.${group.key.slice(-2)}` as never),
            })
          : t(`calendar:groups.${group.key}` as never, {
              from: range(group.from),
              to: range(group.to),
            });
        return (
          <section key={group.key} className={classes.group} aria-label={title}>
            <div className={classes.groupHead}>
              <h2 className={classes.groupTitle}>{title}</h2>
              <span className={classes.groupSum}>
                <Totals totals={group.totals} t={t} onWhy={onWhy} />
              </span>
            </div>
            {group.entries.map((entry) => (
              <EventRow
                key={entry.id}
                entry={entry}
                today={data.today}
                onOpen={() => onOpen(entry.id)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function EventSheet({
  entry,
  today,
  t,
  onClose,
  onWhy,
  onDelete,
  deleting,
  onChanged,
}: {
  readonly entry: CalendarEntry;
  readonly today: LocalDate;
  readonly t: CalendarT;
  readonly onClose: () => void;
  readonly onWhy: (trace: TraceId) => void;
  readonly onDelete: () => void;
  readonly deleting: boolean;
  readonly onChanged: (token: string, message: string) => void;
}) {
  const past = entry.on !== null && entry.on < today;
  const [day, setDay] = useState(entry.on ?? "");
  const update = useMutation(
    orpc.calendar.update.mutationOptions({
      onSuccess: ({ undoToken }) =>
        onChanged(undoToken, t("calendar:toast.changed", { title: eventTitle(t, entry) })),
    }),
  );
  const toggle = (offset: RemindDays[number], on: boolean) => {
    const next = REMIND_DAYS.filter((d) =>
      d === offset ? on : (entry.remindDays as readonly number[]).includes(d),
    );
    update.mutate({ id: entry.id as never, remindDays: [...next] });
  };
  const title = eventTitle(t, entry);
  const links: { readonly text: string; readonly href: string }[] = [];
  if (entry.ref?.entity === "receipt") {
    links.push({
      text: t("calendar:event.links.receipt"),
      href: `/documents?open=${encodeURIComponent(entry.ref.id)}`,
    });
  }
  if (entry.ref?.entity === "recurring") {
    links.push({ text: t("calendar:event.links.recurring"), href: "/recurring" });
  }
  return (
    <Sheet opened onClose={onClose} title={t(`calendar:types.${entry.type}`)}>
      <div className={classes.sheetBody}>
        <h2 className={classes.eventTitle}>{title}</h2>
        <p className={classes.eventWhen}>
          {entry.on === null ? t("calendar:event.noDate") : fullDate(t, entry.on)}
          {entry.on !== null && (
            <span className={classes.rel}>{relativeText(t, entry.on, today)}</span>
          )}
        </p>
        {entry.amount !== null && (
          <p className={classes.amountRow}>
            <span>
              {entry.direction === "in"
                ? t("calendar:event.amountIncome")
                : entry.approx
                  ? t("calendar:event.amountApprox")
                  : t("calendar:event.amountPayment")}
            </span>
            <strong>
              {entry.approx && "≈ "}
              <Money value={entry.amount} kind={entry.direction === "in" ? "income" : "expense"} />
            </strong>
            {entry.traceId !== null && (
              <WhyButton
                subject={t("calendar:event.amountWhy", { title })}
                onClick={() => onWhy(entry.traceId as TraceId)}
              />
            )}
          </p>
        )}
        <section aria-label={t("calendar:event.source")}>
          <h3 className={classes.sheetLabel}>{t("calendar:event.source")}</h3>
          <p className={classes.source}>{originText(t, entry)}</p>
        </section>
        {entry.stored && entry.on !== null && !past && (
          <fieldset className={classes.fieldset}>
            <legend className={classes.sheetLabel}>{t("calendar:event.reminders")}</legend>
            {REMIND_DAYS.toSorted((a, b) => b - a).map((offset) => (
              <Checkbox
                key={offset}
                label={t(`calendar:event.remind.${String(offset)}` as never)}
                checked={(entry.remindDays as readonly number[]).includes(offset)}
                disabled={update.isPending}
                onChange={(e) => toggle(offset, e.currentTarget.checked)}
              />
            ))}
          </fieldset>
        )}
        {entry.stored && entry.on === null && (
          <p className={classes.muted}>{t("calendar:event.remindersOff")}</p>
        )}
        {!entry.stored && !past && (
          <p className={classes.muted}>{t("calendar:event.remindersNone")}</p>
        )}
        {past && <p className={classes.muted}>{t("calendar:event.pastNote")}</p>}
        {entry.stored && !past && (
          <div className={classes.dateEdit}>
            <TextInput
              type="date"
              label={t("calendar:event.changeDate")}
              value={day}
              min={today}
              onChange={(e) => setDay(e.currentTarget.value)}
            />
            <Button
              variant="default"
              disabled={day === "" || day === entry.on || day < today}
              loading={update.isPending}
              onClick={() => update.mutate({ id: entry.id as never, on: LocalDate.parse(day) })}
            >
              {t("calendar:event.saveDate")}
            </Button>
          </div>
        )}
        {links.length > 0 && (
          <section aria-label={t("calendar:event.related")}>
            <h3 className={classes.sheetLabel}>{t("calendar:event.related")}</h3>
            <ul className={classes.links}>
              {links.map((link) => (
                <li key={link.href}>
                  <a href={link.href}>{link.text}</a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {entry.canDelete && (
          <div>
            <Button
              variant="default"
              color="red"
              leftSection={<Trash2 size={16} aria-hidden />}
              loading={deleting}
              onClick={onDelete}
            >
              {t("calendar:event.delete")}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

const FORM_TYPES: readonly CreatableType[] = ["own", "tax", "insurance", "credit", "warranty"];

function AddDialog({
  initialDay,
  today,
  t,
  onClose,
  onCreated,
}: {
  readonly initialDay: string;
  readonly today: LocalDate | null;
  readonly t: CalendarT;
  readonly onClose: () => void;
  readonly onCreated: (entry: CalendarEntry, undoToken: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [on, setOn] = useState(initialDay);
  const [sum, setSum] = useState("");
  const [type, setType] = useState<CreatableType>("own");
  const [remind, setRemind] = useState<readonly number[]>([7, 1]);
  const [failure, setFailure] = useState<string | null>(null);
  const create = useMutation(
    orpc.calendar.create.mutationOptions({
      onSuccess: ({ event, undoToken }) => onCreated(event, undoToken),
      onError: (error) => setFailure(t(`errors:${errorCodeOf(error)}`, errorParamsOf(error))),
    }),
  );
  const parsed = sum.trim() === "" ? undefined : parseMoney(sum, "BYN");
  const input = CreateEventInput.safeParse({
    title,
    on,
    type,
    remindDays: REMIND_DAYS.filter((d) => remind.includes(d)),
    ...(parsed === undefined ? {} : { amount: parsed }),
  });
  const valid =
    input.success &&
    (today === null || on >= today) &&
    (sum.trim() === "" || (parsed !== undefined && parsed.minor > 0));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    if (input.success && valid) create.mutate(input.data);
  };
  return (
    <Modal
      opened
      onClose={onClose}
      centered
      title={t("calendar:form.title")}
      closeButtonProps={{ "aria-label": t("calendar:event.close") }}
    >
      <form onSubmit={submit} noValidate>
        <Stack gap="md">
          <TextInput
            label={t("calendar:form.name")}
            placeholder={t("calendar:form.namePlaceholder")}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
          <div className={classes.formRow}>
            <TextInput
              type="date"
              label={t("calendar:form.date")}
              value={on}
              min={today ?? undefined}
              onChange={(e) => setOn(e.currentTarget.value)}
            />
            <TextInput
              label={t("calendar:form.sum")}
              placeholder={t("calendar:form.sumPlaceholder")}
              inputMode="decimal"
              value={sum}
              onChange={(e) => setSum(e.currentTarget.value)}
            />
          </div>
          <Select
            label={t("calendar:form.type")}
            allowDeselect={false}
            value={type}
            data={FORM_TYPES.map((value) => ({
              value,
              label: t(`calendar:form.types.${value}`),
            }))}
            onChange={(value) => setType((value ?? "own") as CreatableType)}
          />
          <fieldset className={classes.fieldset}>
            <legend className={classes.sheetLabel}>{t("calendar:form.remind")}</legend>
            {REMIND_DAYS.toSorted((a, b) => b - a).map((offset) => (
              <Checkbox
                key={offset}
                label={t(`calendar:event.remind.${String(offset)}` as never)}
                checked={remind.includes(offset)}
                onChange={(e) =>
                  setRemind(
                    e.currentTarget.checked
                      ? [...remind, offset]
                      : remind.filter((d) => d !== offset),
                  )
                }
              />
            ))}
          </fieldset>
          {!valid && (title !== "" || sum !== "") && (
            <p className={classes.error} role="alert">
              <AlertTriangle size={16} aria-hidden />
              {t("calendar:form.invalid")}
            </p>
          )}
          {failure !== null && (
            <p className={classes.error} role="alert">
              {failure}
            </p>
          )}
          <div className={classes.buttons}>
            <Button type="submit" disabled={!valid} loading={create.isPending}>
              {t("calendar:form.submit")}
            </Button>
            <Button variant="default" onClick={onClose}>
              {t("calendar:form.cancel")}
            </Button>
          </div>
        </Stack>
      </form>
    </Modal>
  );
}
