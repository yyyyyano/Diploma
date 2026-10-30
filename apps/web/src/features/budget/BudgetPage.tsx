// «Лимиты и цели» (design/screens/Budget.dc.html, BUD-01…07, EXPL-01, P5, AGT-07): лимиты месяца с полосами и порогами,
// цели — копилка или остаток накопительного счёта, рекомендуемый взнос и «укладывается ли в свободный остаток». Числа и
// проценты приходят с сервера (P1), ⓘ открывает сохранённый расчёт. Изменение — сразу и с «Отменить»; удаление лимита и
// цели — только решением «Да/Нет». Четыре состояния (DES-16); обновляет поток событий (`budget`, `goal`, `transaction`).
import type { BudgetGoal, BudgetLimit } from "@kosht/contract";
import { formatMoney } from "@kosht/i18n";
import type { TraceId } from "@kosht/kernel";
import { Button, Chip, Modal } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DecisionDialog, UndoActionToast } from "../../entities/action/index.ts";
import { categoryRefOf, useCategoryLookup } from "../../entities/category/index.ts";
import { ExplanationSheet } from "../../entities/explanation/index.ts";
import { ContributeDialog, GoalCard } from "../../entities/goal/index.ts";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import {
  CategoryIcon,
  EmptyState,
  LimitBar,
  Money,
  PageHeader,
  SkeletonCard,
  WhyButton,
} from "../../ui/index.ts";
import { GoalForm } from "./GoalForm.tsx";
import { LimitForm } from "./LimitForm.tsx";
import { monthWord } from "./model/format.ts";
import classes from "./BudgetPage.module.css";

type Dialog =
  | { readonly kind: "limit"; readonly limit?: BudgetLimit }
  | { readonly kind: "goal"; readonly goal?: BudgetGoal };
type Toast = { readonly token: string; readonly message: string };
type Delete = { readonly decisionId: string; readonly label: string };

export function BudgetPage() {
  const { t } = useTranslation(["budget", "errors", "ui"]);
  const queryClient = useQueryClient();
  const lookup = useCategoryLookup();
  const overview = useQuery(orpc.budgets.overview.queryOptions({ input: {} }));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [contributeTo, setContributeTo] = useState<BudgetGoal | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [traceId, setTraceId] = useState<TraceId | null>(null);
  const [removal, setRemoval] = useState<Delete | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.budgets.key() });

  const failed = (error: unknown) => {
    const reason = errorParamsOf(error)["reason"];
    setNotice(
      t("budget:actionError", {
        reason:
          typeof reason === "string"
            ? t(`budget:reasons.${reason}`, { defaultValue: t("errors:VALIDATION") })
            : t(`errors:${errorCodeOf(error)}`),
      }),
    );
  };
  const done = (message: string) => async (result: { undoToken: string }) => {
    setDialog(null);
    setContributeTo(null);
    setNotice(null);
    setToast({ token: result.undoToken, message });
    await refresh();
  };
  const categoryOf = (key: string) => {
    const ref = categoryRefOf(key);
    return ref === undefined ? key : lookup.nameOf(ref);
  };
  const setLimit = useMutation(
    orpc.budgets.setLimit.mutationOptions({
      onError: failed,
      onSuccess: (result) =>
        done(
          t("budget:done.limitSet", {
            category: categoryOf(result.limit.categoryKey),
            amount: formatMoney(result.limit.limit),
          }),
        )(result),
    }),
  );
  const createGoal = useMutation(
    orpc.budgets.createGoal.mutationOptions({
      onError: failed,
      onSuccess: (result) => done(t("budget:done.goalCreated", { name: result.goal.name }))(result),
    }),
  );
  const updateGoal = useMutation(
    orpc.budgets.updateGoal.mutationOptions({
      onError: failed,
      onSuccess: (result) => done(t("budget:done.goalUpdated", { name: result.goal.name }))(result),
    }),
  );
  const askDelete = (label: string) => ({
    onError: failed,
    onSuccess: ({ decisionId }: { decisionId: string }) => setRemoval({ decisionId, label }),
  });
  const deleteLimit = useMutation(orpc.budgets.requestDeleteLimit.mutationOptions());
  const deleteGoal = useMutation(orpc.budgets.requestDeleteGoal.mutationOptions());

  const data = overview.data;
  const limits = data?.limits ?? [];
  const goals = data?.goals ?? [];
  const month = data?.month;
  const monthName = month === undefined ? "" : monthWord(t, month);

  return (
    <>
      <PageHeader
        title={t("budget:title")}
        {...(data === undefined || month === undefined
          ? {}
          : {
              subtitle: t("budget:subtitle", {
                month: `${monthWord(t, month, true)} ${month.slice(0, 4)}`,
                days: t("budget:daysLeft", { count: data.daysLeft }),
              }),
            })}
        actions={
          <>
            <Button
              variant="default"
              leftSection={<Plus size={18} aria-hidden />}
              onClick={() => setDialog({ kind: "limit" })}
            >
              {t("budget:newLimit")}
            </Button>
            <Button
              leftSection={<Target size={18} aria-hidden />}
              onClick={() => setDialog({ kind: "goal" })}
            >
              {t("budget:newGoal")}
            </Button>
          </>
        }
      />
      <div className={classes.body}>
        {overview.isPending && (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}
        {overview.isError && (
          <EmptyState
            tone="error"
            icon={AlertTriangle}
            title={t("budget:error.title")}
            description={t("budget:error.text")}
            actions={
              <Button onClick={() => void overview.refetch()}>{t("budget:error.retry")}</Button>
            }
          />
        )}
        {notice !== null && (
          <p className={classes.error} role="alert">
            <AlertTriangle size={18} aria-hidden />
            {notice}
          </p>
        )}
        {data !== undefined && (
          <div className={classes.columns}>
            <section aria-labelledby="bud-limits" className={classes.column}>
              <div className={classes.sectionHead}>
                <h2 id="bud-limits" className={classes.heading}>
                  {t("budget:limits.title", { month: monthName })}
                </h2>
                <p className={classes.muted}>{t("budget:limits.hint")}</p>
              </div>
              {limits.length === 0 && (
                <EmptyState
                  icon={Target}
                  title={t("budget:limits.empty.title")}
                  description={t("budget:limits.empty.text")}
                  actions={
                    <Button onClick={() => setDialog({ kind: "limit" })}>
                      {t("budget:newLimit")}
                    </Button>
                  }
                />
              )}
              {limits.map((limit) => {
                const ref = categoryRefOf(limit.categoryKey);
                const item = ref === undefined ? undefined : lookup.find(ref);
                const name = categoryOf(limit.categoryKey);
                const over = limit.remaining.minor < 0;
                const status = over
                  ? t("budget:limits.statusOver", {
                      percent: limit.percent,
                      over: formatMoney({ ...limit.remaining, minor: -limit.remaining.minor }),
                    })
                  : t("budget:limits.statusOk", {
                      percent: limit.percent,
                      left: formatMoney(limit.remaining),
                      days: t("budget:daysLeft", { count: data.daysLeft }),
                    });
                return (
                  <article key={limit.id} className={classes.card} aria-label={name}>
                    <header className={classes.cardHead}>
                      {item !== undefined && <CategoryIcon icon={item.icon} color={item.color} />}
                      <h3 className={classes.cardTitle}>{name}</h3>
                      <button
                        type="button"
                        className={classes.iconButton}
                        aria-label={t("budget:limits.edit", { category: name })}
                        onClick={() => setDialog({ kind: "limit", limit })}
                      >
                        <Pencil size={16} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={classes.iconButton}
                        aria-label={t("budget:limits.delete", { category: name })}
                        onClick={() =>
                          deleteLimit.mutate(
                            { id: limit.id },
                            askDelete(t("budget:limits.deleteYes", { category: name })),
                          )
                        }
                      >
                        <Trash2 size={16} aria-hidden />
                      </button>
                    </header>
                    <div className={classes.amounts}>
                      <span className={classes.spent}>
                        <Money value={limit.spent} />
                      </span>
                      <span className={classes.of}>
                        {t("budget:limits.of")} <Money value={limit.limit} />
                      </span>
                      <WhyButton
                        subject={t("budget:limits.whyLabel", { category: name })}
                        onClick={() => setTraceId(limit.traceId)}
                      />
                    </div>
                    <LimitBar
                      percent={limit.percent}
                      label={name}
                      status={status}
                      marker={t("budget:limits.notify80")}
                    />
                    {limit.missingRates > 0 && (
                      <p className={classes.muted}>{t("budget:limits.missingRates")}</p>
                    )}
                    <div className={classes.notify}>
                      <span className={classes.muted}>{t("budget:limits.notify")}</span>
                      {(["notify80", "notify100"] as const).map((flag) => (
                        <Chip
                          key={flag}
                          size="xs"
                          checked={limit[flag]}
                          onChange={(checked) =>
                            setLimit.mutate({
                              categoryKey: limit.categoryKey,
                              limit: limit.limit,
                              [flag]: checked,
                            })
                          }
                        >
                          {t(
                            flag === "notify80"
                              ? "budget:limits.notify80"
                              : "budget:limits.notify100",
                          )}
                        </Chip>
                      ))}
                    </div>
                  </article>
                );
              })}
            </section>

            <section aria-labelledby="bud-goals" className={classes.column}>
              <div className={classes.sectionHead}>
                <h2 id="bud-goals" className={classes.heading}>
                  {t("budget:goals.title")}
                </h2>
                <p className={classes.muted}>{t("budget:goals.hint")}</p>
              </div>
              {goals.length === 0 && (
                <EmptyState
                  icon={Target}
                  title={t("budget:goals.empty.title")}
                  description={t("budget:goals.empty.text")}
                  actions={
                    <Button onClick={() => setDialog({ kind: "goal" })}>
                      {t("budget:newGoal")}
                    </Button>
                  }
                />
              )}
              {goals.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  freeBalance={data.freeBalance}
                  onWhy={setTraceId}
                  onContribute={setContributeTo}
                  actions={
                    <span className={classes.actions}>
                      <button
                        type="button"
                        className={classes.iconButton}
                        aria-label={t("budget:goals.edit", { name: goal.name })}
                        onClick={() => setDialog({ kind: "goal", goal })}
                      >
                        <Pencil size={16} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={classes.iconButton}
                        aria-label={t("budget:goals.delete", { name: goal.name })}
                        onClick={() =>
                          deleteGoal.mutate(
                            { id: goal.id },
                            askDelete(t("budget:goals.deleteYes", { name: goal.name })),
                          )
                        }
                      >
                        <Trash2 size={16} aria-hidden />
                      </button>
                    </span>
                  }
                />
              ))}
            </section>
          </div>
        )}
      </div>

      <Modal
        opened={dialog !== null}
        onClose={() => setDialog(null)}
        closeButtonProps={{ "aria-label": t("ui:sheet.close") }}
        title={
          dialog?.kind === "limit"
            ? dialog.limit === undefined
              ? t("budget:limitForm.titleNew")
              : t("budget:limitForm.titleEdit", { category: categoryOf(dialog.limit.categoryKey) })
            : dialog?.goal === undefined
              ? t("budget:goalForm.title")
              : t("budget:goalForm.titleEdit", { name: dialog.goal.name })
        }
      >
        {dialog?.kind === "limit" && (
          <LimitForm
            {...(dialog.limit === undefined ? {} : { limit: dialog.limit })}
            pending={setLimit.isPending}
            onCancel={() => setDialog(null)}
            onSubmit={(input) => setLimit.mutate(input)}
          />
        )}
        {dialog?.kind === "goal" && (
          <GoalForm
            {...(dialog.goal === undefined ? {} : { goal: dialog.goal })}
            pending={createGoal.isPending || updateGoal.isPending}
            onCancel={() => setDialog(null)}
            onSubmit={(input) =>
              dialog.goal === undefined
                ? createGoal.mutate(input)
                : updateGoal.mutate({
                    id: dialog.goal.id,
                    name: input.name,
                    target: input.target,
                    deadline: input.deadline,
                  })
            }
          />
        )}
      </Modal>

      <ContributeDialog
        goal={contributeTo}
        onClose={() => setContributeTo(null)}
        onDone={(result) =>
          void done(
            t("budget:done.contributed", {
              amount: `${result.amountText} BYN`,
              name: result.goal.name,
            }),
          )(result)
        }
      />
      {removal !== null && (
        <DecisionDialog
          decisionId={removal.decisionId}
          opened
          confirmLabel={removal.label}
          onClose={() => setRemoval(null)}
          onAnswered={(status) => {
            setRemoval(null);
            if (status === "yes") setNotice(null);
            void refresh();
          }}
        />
      )}
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
            setNotice(result.ok ? null : t("budget:done.undoFailed"));
            void refresh();
          }}
        />
      )}
    </>
  );
}
