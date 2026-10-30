// «Регулярные платежи» (design/screens/Recurring.dc.html, REC-01…05, EXPL-01, P5): найденные по истории платежи по
// разделам — Доходы, Обязательные, Подписки, Другие регулярные — с периодом, средней суммой, следующей датой и
// состоянием; решения по предположениям («Да, регулярный», «Это не регулярный», «Да, прекращён», «Ещё придёт»),
// исправить, исключить, добавить вручную — сразу и с «Отменить». Суммы и итоги приходят с сервера (P1); ⓘ у средней суммы
// открывает «Откуда эта цифра?» с операциями-основаниями. Четыре состояния (DES-16); список обновляет поток событий.
// Блок свободного остатка добавит T-031.
import { type RecurringItem } from "@kosht/contract";
import { formatDate, formatMoney, formatRelativeDay } from "@kosht/i18n";
import type { TraceId } from "@kosht/kernel";
import { Button, Modal, SegmentedControl } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check, Plus, Repeat, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UndoActionToast } from "../../entities/action/index.ts";
import { CategoryBadge } from "../../entities/category/index.ts";
import { ExplanationSheet } from "../../entities/explanation/index.ts";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf } from "../../lib/errors.ts";
import { EmptyState, Money, PageHeader, SkeletonCard, WhyButton } from "../../ui/index.ts";
import { categoryRef, everyText, periodText, SECTIONS } from "./model/format.ts";
import { RecurringSearch } from "./model/search.ts";
import { FreeBalanceCard } from "./FreeBalanceCard.tsx";
import { AddForm, EditForm } from "./RecurringForms.tsx";
import { RowMenu, StateBadge } from "./RecurringRows.tsx";
import classes from "./RecurringPage.module.css";

const TABS = ["all", "income", "mandatory", "subscriptions"] as const;

type Dialog = { readonly kind: "add" } | { readonly kind: "edit"; readonly item: RecurringItem };
type Toast = { readonly token: string; readonly message: string };

export function RecurringPage({ search }: { readonly search: RecurringSearch }) {
  const { t } = useTranslation("recurring");
  const { t: tErr } = useTranslation("errors");
  const { t: tUi } = useTranslation("ui");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery(orpc.recurring.list.queryOptions({ input: {} }));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [traceId, setTraceId] = useState<TraceId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.recurring.key() });

  const failed = (error: unknown) =>
    setNotice(t("actionError", { reason: tErr(`${errorCodeOf(error)}`) }));
  const changed =
    (message: (name: string) => string) =>
    async (result: { item: RecurringItem; undoToken: string }) => {
      setDialog(null);
      setNotice(null);
      setToast({ token: result.undoToken, message: message(result.item.name) });
      await refresh();
    };
  const decision = { onError: failed, changed };
  const confirm = useDecision("confirm", decision);
  const exclude = useDecision("exclude", decision);
  const end = useDecision("end", decision);
  const resume = useDecision("resume", decision);
  const stillComing = useDecision("stillComing", decision);
  const edit = useMutation(
    orpc.recurring.edit.mutationOptions({
      onError: failed,
      onSuccess: changed((name) => t("done.edit", { name })),
    }),
  );
  const create = useMutation(
    orpc.recurring.create.mutationOptions({
      onError: failed,
      onSuccess: changed((name) => t("done.create", { name })),
    }),
  );
  const explain = useMutation(
    orpc.recurring.explain.mutationOptions({
      onSuccess: ({ traceId: id }) => setTraceId(id),
      onError: () => setNotice(t("whyError")),
    }),
  );

  const data = list.data;
  const items = data?.items ?? [];
  const live = items.filter((item) => item.state !== "ended");
  const ended = items.filter((item) => item.state === "ended");
  const suggested = live.filter((item) => item.state === "suggested");
  const missed = live.filter((item) => item.state === "maybe-ended");
  const tab = search.section ?? "all";
  const shown = SECTIONS.filter((section) => tab === "all" || tab === section);
  const onDate = data?.onDate;

  const showOperations = (item: RecurringItem) =>
    void navigate({ to: "/operations", search: { q: item.name } });

  return (
    <>
      <PageHeader
        title={t("title")}
        {...(onDate === undefined ? {} : { subtitle: t("subtitle", { date: formatDate(onDate) }) })}
        actions={
          <Button
            leftSection={<Plus size={18} aria-hidden />}
            onClick={() => setDialog({ kind: "add" })}
          >
            {t("add.button")}
          </Button>
        }
      />
      <div className={classes.body}>
        <FreeBalanceCard onWhy={setTraceId} />
        {list.isPending && (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}
        {list.isError && (
          <EmptyState
            tone="error"
            icon={AlertTriangle}
            title={t("error.title")}
            description={t("error.text")}
            actions={<Button onClick={() => void list.refetch()}>{t("error.retry")}</Button>}
          />
        )}
        {notice !== null && (
          <p className={classes.error} role="alert">
            <AlertTriangle size={18} aria-hidden />
            {notice}
          </p>
        )}
        {data !== undefined && items.length === 0 && (
          <EmptyState
            icon={Repeat}
            title={t("empty.title")}
            description={t("empty.text")}
            actions={<Button onClick={() => setDialog({ kind: "add" })}>{t("add.button")}</Button>}
          />
        )}
        {data !== undefined && onDate !== undefined && items.length > 0 && (
          <>
            {(suggested.length > 0 || missed.length > 0) && (
              <section aria-labelledby="rec-decisions" className={classes.decisions}>
                <h2 id="rec-decisions" className={classes.heading}>
                  {t("decisions.title")}
                </h2>
                {suggested.map((item) => (
                  <article key={item.id} className={classes.decision}>
                    <span className={classes.decisionIcon}>
                      <Repeat size={20} aria-hidden />
                    </span>
                    <div className={classes.decisionBody}>
                      <h3 className={classes.decisionTitle}>{t("decisions.suggestedTitle")}</h3>
                      <p className={classes.decisionText}>
                        {t("decisions.suggestedText", {
                          name: item.name,
                          amount: formatMoney(item.amount),
                          period: everyText(t, item),
                          repeats: t("decisions.repeats", { count: item.repeats }),
                        })}
                      </p>
                      <div className={classes.buttons}>
                        <Button
                          leftSection={<Check size={16} aria-hidden />}
                          onClick={() => confirm.mutate({ id: item.id })}
                        >
                          {t("decisions.suggestedYes")}
                        </Button>
                        <Button variant="default" onClick={() => exclude.mutate({ id: item.id })}>
                          {t("decisions.suggestedNo")}
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
                {missed.map((item) => (
                  <article key={item.id} className={classes.decision}>
                    <span className={`${classes.decisionIcon} ${classes.decisionWarn}`}>
                      <AlertTriangle size={20} aria-hidden />
                    </span>
                    <div className={classes.decisionBody}>
                      <h3 className={classes.decisionTitle}>{t("decisions.missedTitle")}</h3>
                      <p className={classes.decisionText}>
                        {t("decisions.missedText", {
                          name: item.name,
                          amount: formatMoney(item.amount),
                          date: formatDate(item.nextExpectedOn),
                          days: t("days", { count: item.overdueDays ?? 0 }),
                        })}
                      </p>
                      <div className={classes.buttons}>
                        <Button variant="default" onClick={() => end.mutate({ id: item.id })}>
                          {t("decisions.missedYes")}
                        </Button>
                        <Button
                          variant="subtle"
                          onClick={() => stillComing.mutate({ id: item.id })}
                        >
                          {t("decisions.missedNo")}
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            )}

            <div className={classes.filter}>
              <SegmentedControl
                aria-label={t("filter.label")}
                value={tab}
                onChange={(value) =>
                  void navigate({
                    to: "/recurring",
                    search: RecurringSearch.parse({ section: value === "all" ? undefined : value }),
                  })
                }
                data={TABS.map((value) => ({ value, label: t(`filter.${value}`) }))}
              />
              <span className={classes.count}>{t("count", { count: live.length })}</span>
            </div>

            {shown.map((section) => {
              const rows = live.filter((item) => item.section === section);
              const total = data.totals.find((entry) => entry.section === section);
              const monthlyTotal = total?.monthly ?? null;
              const yearlyTotal = total?.yearly ?? null;
              return (
                <section
                  key={section}
                  className={classes.section}
                  aria-labelledby={`rec-${section}`}
                >
                  <div className={classes.sectionHead}>
                    <div>
                      <h2 id={`rec-${section}`} className={classes.sectionTitle}>
                        {t(`section.${section}.title`)}
                      </h2>
                      <p className={classes.sectionHint}>{t(`section.${section}.hint`)}</p>
                    </div>
                    {monthlyTotal !== null && (
                      <div className={classes.sectionTotal}>
                        <Money
                          value={monthlyTotal}
                          {...(section === "income" ? { kind: "income" as const } : {})}
                        />
                        <span className={classes.sectionTotalSub}>
                          {t("section.perMonth")}
                          {section === "subscriptions" && yearlyTotal !== null
                            ? ` · ${t("section.perYear", { amount: formatMoney(yearlyTotal) })}`
                            : ""}
                        </span>
                      </div>
                    )}
                  </div>
                  {rows.length === 0 ? (
                    <p className={classes.empty}>{t("section.empty")}</p>
                  ) : (
                    <ul className={classes.list}>
                      {rows.map((item) => (
                        <li key={item.id} className={classes.row}>
                          <div>
                            <span className={classes.rowName}>{item.name}</span>
                            <span className={classes.rowSub}>
                              <CategoryBadge category={categoryRef(item)} />
                            </span>
                          </div>
                          <span>{periodText(t, item)}</span>
                          <div className={classes.rowAmount}>
                            <span className={classes.rowAmountLine}>
                              {item.amountRange !== null && (
                                <span aria-hidden>{t("row.approx")}</span>
                              )}
                              <Money
                                value={item.amount}
                                tabular
                                {...(item.flow === "income" ? { kind: "income" as const } : {})}
                              />
                              {item.amountRange !== null && (
                                <WhyButton
                                  subject={t("row.why", { name: item.name })}
                                  onClick={() => explain.mutate({ id: item.id })}
                                />
                              )}
                            </span>
                            <span className={classes.rowSub}>
                              {item.amountRange === null
                                ? t(`period.per.${item.period}`)
                                : t("row.range", {
                                    min: formatMoney(item.amountRange.min),
                                    max: formatMoney(item.amountRange.max),
                                  })}
                            </span>
                          </div>
                          <div>
                            {item.state === "maybe-ended" ? (
                              <>
                                <span>
                                  {t("row.expected", {
                                    date: formatDate(item.nextExpectedOn),
                                  })}
                                </span>
                                <span className={`${classes.rowSub} ${classes.late}`}>
                                  {t("row.late", {
                                    days: t("days", { count: item.overdueDays ?? 0 }),
                                  })}
                                </span>
                              </>
                            ) : (
                              <>
                                <span>
                                  {t("row.next", {
                                    date: formatDate(item.nextExpectedOn),
                                  })}
                                </span>
                                <span className={`${classes.rowSub} ${classes.soon}`}>
                                  {formatRelativeDay(item.nextExpectedOn, onDate)}
                                </span>
                              </>
                            )}
                          </div>
                          <StateBadge t={t} item={item} />
                          <RowMenu
                            t={t}
                            item={item}
                            onEdit={() => setDialog({ kind: "edit", item })}
                            onOperations={() => showOperations(item)}
                            onExclude={() => exclude.mutate({ id: item.id })}
                            onEnd={() => end.mutate({ id: item.id })}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}

            {ended.length > 0 && (
              <section className={classes.section} aria-labelledby="rec-ended">
                <div className={classes.sectionHead}>
                  <div>
                    <h2 id="rec-ended" className={classes.sectionTitle}>
                      {t("ended.title")}
                    </h2>
                    <p className={classes.sectionHint}>{t("ended.hint")}</p>
                  </div>
                </div>
                {ended.map((item) => (
                  <div key={item.id} className={classes.endedRow}>
                    <div>
                      <span className={classes.rowName}>{item.name}</span>
                      <span className={classes.rowSub}>
                        {t("ended.last", {
                          amount: formatMoney(item.amount),
                          date:
                            item.lastOccurredOn === null ? "—" : formatDate(item.lastOccurredOn),
                        })}
                      </span>
                    </div>
                    <Button variant="default" onClick={() => resume.mutate({ id: item.id })}>
                      {t("ended.resume")}
                    </Button>
                  </div>
                ))}
              </section>
            )}

            <section className={classes.section} aria-labelledby="rec-how">
              <div className={classes.sectionHead}>
                <div>
                  <h2 id="rec-how" className={classes.sectionTitle}>
                    {t("how.title")}
                  </h2>
                  <p className={classes.sectionHint}>{t("how.hint")}</p>
                </div>
              </div>
              <div className={classes.how}>
                {(["repeats", "amount", "day", "missed"] as const).map((key) => (
                  <div key={key} className={classes.howCard}>
                    <p className={classes.howValue}>{t(`how.${key}.value`)}</p>
                    <p className={classes.howText}>{t(`how.${key}.text`)}</p>
                  </div>
                ))}
              </div>
              <p className={classes.note}>
                <ShieldCheck size={16} aria-hidden />
                {t("how.note")}
              </p>
            </section>
          </>
        )}
      </div>

      <Modal
        opened={dialog !== null}
        onClose={() => setDialog(null)}
        closeButtonProps={{ "aria-label": tUi("sheet.close") }}
        title={
          dialog?.kind === "edit" ? t("edit.title", { name: dialog.item.name }) : t("create.title")
        }
      >
        {dialog?.kind === "edit" && (
          <EditForm
            item={dialog.item}
            pending={edit.isPending}
            onCancel={() => setDialog(null)}
            onSubmit={(input) => edit.mutate(input)}
          />
        )}
        {dialog?.kind === "add" && (
          <AddForm
            pending={create.isPending}
            onCancel={() => setDialog(null)}
            onSubmit={(input) => create.mutate(input)}
          />
        )}
      </Modal>

      {traceId !== null && (
        <ExplanationSheet traceId={traceId} opened onClose={() => setTraceId(null)} />
      )}
      {toast !== null && (
        <UndoActionToast
          key={toast.token}
          token={toast.token}
          message={toast.message}
          opened
          onClose={() => setToast(null)}
          onResult={(result) => {
            setNotice(
              result.ok || errorCodeOf(result.error) !== "CONFLICT" ? null : t("undoConflict"),
            );
            void refresh();
          }}
        />
      )}
    </>
  );
}

type Decision = "confirm" | "exclude" | "end" | "resume" | "stillComing";

/** Решение человека («Да, регулярный», «Это не регулярный»…): сразу, с «Отменить» (P5). */
function useDecision(
  key: Decision,
  handlers: {
    readonly onError: (error: unknown) => void;
    readonly changed: (
      message: (name: string) => string,
    ) => (result: { item: RecurringItem; undoToken: string }) => Promise<void>;
  },
) {
  const { t } = useTranslation("recurring");
  return useMutation(
    orpc.recurring[key].mutationOptions({
      onError: handlers.onError,
      onSuccess: handlers.changed((name) => t(`done.${key}`, { name })),
    }),
  );
}
