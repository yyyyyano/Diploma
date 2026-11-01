// «Главная» (design/screens/Main.dc.html, MobileHome.dc.html; DASH-01…04, EXPL-01, REC-03, BUD-02, DES-13…15): период,
// остатки, доходы и расходы, траты по категориям (кольцо), динамика по месяцам, лимиты и цели, ближайшие платежи,
// свободный остаток. Все числа и их расчёты приходят одним ответом `dashboard.overview` (P1, P2): у каждого числа — ⓘ с
// сохранённой трассой. Категория и месяц ведут в «Операции» с тем же периодом (DASH-03). Четыре состояния (DES-16):
// загрузка, «первые шаги» вместо пустых графиков (DASH-04), ошибка, данные. Виджеты вычетов, календаря и итогов недели —
// фаза 7. Обновляет поток событий (`transaction`, `account`, `budget`, `goal`, `recurring`).
import type { DashboardOverview } from "@kosht/contract";
import { formatDate, formatMoney } from "@kosht/i18n";
import type { TraceId } from "@kosht/kernel";
import { Button } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, FileText, LayoutDashboard, Plus } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { UndoActionToast } from "../../entities/action/index.ts";
import { useAccountName } from "../../entities/account/index.ts";
import { EventRow, useCalendarTexts } from "../../entities/calendar-event/index.ts";
import { categoryRefOf, useCategoryLookup } from "../../entities/category/index.ts";
import { FoundBanner, useFoundChange } from "../../entities/deduction/index.ts";
import { ExplanationSheet } from "../../entities/explanation/index.ts";
import { ContributeDialog, GoalCard } from "../../entities/goal/index.ts";
import { orpc } from "../../lib/api.ts";
import {
  CATEGORY_COLORS,
  ColumnChart,
  DonutChart,
  EmptyState,
  LimitBar,
  Money,
  PageHeader,
  SkeletonCard,
  StatCard,
  WhyButton,
} from "../../ui/index.ts";
import classes from "./HomePage.module.css";
import { monthRange, type Period } from "./model/period.ts";
import type { HomeSearch } from "./model/search.ts";

/**
 * Календарь Mantine Dates (+ dayjs) — ≈ 48 КБ gzip по замеру T-033: грузится отдельным чанком, а не в первую загрузку сайта
 * (бюджет `bundle-size.mjs`); пока он едет, на месте выбора периода пусто — остальная главная уже показана.
 */
const PeriodBar = lazy(() =>
  import("./PeriodBar.tsx").then((module) => ({ default: module.PeriodBar })),
);

type Toast = { readonly token: string; readonly message: string };

export function HomePage({ search }: { readonly search: HomeSearch }) {
  useCalendarTexts();
  const { t } = useTranslation(["dashboard", "budget", "accounts", "categories", "calendar"]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const lookup = useCategoryLookup();
  const accountName = useAccountName();
  const custom = search.from !== undefined && search.to !== undefined;
  const overview = useQuery(
    orpc.dashboard.overview.queryOptions({
      input: custom ? { from: search.from, to: search.to } : {},
    }),
  );
  const found = useFoundChange();
  const [traceId, setTraceId] = useState<TraceId | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contributeTo, setContributeTo] = useState<DashboardOverview["goals"][number] | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.dashboard.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.budgets.key() }),
    ]);

  const data = overview.data;
  const period: Period | undefined = data?.period;
  const setPeriod = (next: Period) =>
    void navigate({ to: "/home", search: { from: next.from, to: next.to } });
  const categoryName = (key: string) => {
    const ref = categoryRefOf(key);
    return ref === undefined ? key : lookup.nameOf(ref);
  };
  const toOperations = (range: Period, extra: { category?: string; type?: "income" | "expense" }) =>
    void navigate({ to: "/operations", search: { from: range.from, to: range.to, ...extra } });

  return (
    <>
      <PageHeader
        title={t("dashboard:title")}
        actions={
          period === undefined ? undefined : (
            <Suspense fallback={null}>
              <PeriodBar period={period} onChange={setPeriod} />
            </Suspense>
          )
        }
      />
      <div className={classes.body}>
        {overview.isPending && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}
        {overview.isError && (
          <EmptyState
            tone="error"
            icon={AlertTriangle}
            title={t("dashboard:error.title")}
            description={t("dashboard:error.text")}
            actions={
              <Button onClick={() => void overview.refetch()}>{t("dashboard:error.retry")}</Button>
            }
          />
        )}
        {notice !== null && (
          <p className={classes.error} role="alert">
            <AlertTriangle size={18} aria-hidden />
            {notice}
          </p>
        )}
        {data !== undefined && !data.hasData && (
          <EmptyState
            icon={LayoutDashboard}
            title={t("dashboard:empty.title")}
            description={t("dashboard:empty.text")}
            actions={
              <>
                <Button
                  component={Link}
                  to="/documents"
                  leftSection={<FileText size={18} aria-hidden />}
                >
                  {t("dashboard:empty.upload")}
                </Button>
                <Button
                  component={Link}
                  to="/operations"
                  variant="default"
                  leftSection={<Plus size={18} aria-hidden />}
                >
                  {t("dashboard:empty.add")}
                </Button>
              </>
            }
          />
        )}
        {data !== undefined && data.foundDeductions.length > 0 && (
          <FoundBanner
            items={data.foundDeductions}
            change={found.change}
            pending={found.pending}
            failed={found.failed}
          />
        )}
        {data !== undefined && data.hasData && (
          <>
            <section className={classes.kpis} aria-label={t("dashboard:kpi.label")}>
              <StatCard
                title={t("dashboard:kpi.balance")}
                value={
                  data.accounts.total === null ? (
                    t("dashboard:accounts.noRate")
                  ) : (
                    <Money value={data.accounts.total.amount} size="kpi" />
                  )
                }
                hint={
                  data.accounts.total === null
                    ? t("dashboard:kpi.balanceNoRate")
                    : t("dashboard:kpi.balanceHint")
                }
                {...(data.accounts.total === null
                  ? {}
                  : {
                      why: (
                        <WhyButton
                          subject={t("dashboard:kpi.whyBalance")}
                          onClick={() => setTraceId(data.accounts.total?.traceId ?? null)}
                        />
                      ),
                    })}
              />
              <StatCard
                title={t("dashboard:kpi.income")}
                value={<Money value={data.income.amount} kind="income" size="kpi" />}
                hint={t("dashboard:kpi.periodHint")}
                why={
                  <WhyButton
                    subject={t("dashboard:kpi.whyIncome")}
                    onClick={() => setTraceId(data.income.traceId)}
                  />
                }
              />
              <StatCard
                title={t("dashboard:kpi.expense")}
                value={<Money value={data.expense.amount} size="kpi" />}
                hint={t("dashboard:kpi.periodHint")}
                why={
                  <WhyButton
                    subject={t("dashboard:kpi.whyExpense")}
                    onClick={() => setTraceId(data.expense.traceId)}
                  />
                }
              />
              <StatCard
                tone="free"
                title={t("dashboard:kpi.free")}
                value={
                  data.freeBalance.amount === null ? (
                    <span className={classes.noValue}>
                      {t(
                        data.freeBalance.reason === "no-regular-income"
                          ? "dashboard:kpi.freeNoIncome"
                          : "dashboard:kpi.freeNone",
                      )}
                    </span>
                  ) : (
                    <Money value={data.freeBalance.amount} size="kpi" />
                  )
                }
                hint={
                  data.freeBalance.amount === null
                    ? undefined
                    : `${t("dashboard:kpi.freePerMonth")} · ${t("dashboard:kpi.freeMonths", { count: data.freeBalance.months })}`
                }
                {...(data.freeBalance.traceId === null
                  ? {}
                  : {
                      why: (
                        <WhyButton
                          subject={t("dashboard:kpi.whyFree")}
                          onClick={() => setTraceId(data.freeBalance.traceId)}
                        />
                      ),
                    })}
              />
            </section>
            {data.missingRates > 0 && (
              <p className={classes.muted}>{t("dashboard:categories.missingRates")}</p>
            )}

            <div className={classes.columns}>
              <section className={classes.card} aria-labelledby="home-categories">
                <h2 id="home-categories" className={classes.heading}>
                  {t("dashboard:categories.title")}
                </h2>
                {data.categories.rows.length === 0 ? (
                  <p className={classes.muted}>{t("dashboard:categories.empty")}</p>
                ) : (
                  <div className={classes.donutWrap}>
                    <DonutChart
                      label={t("dashboard:categories.title")}
                      centerLabel={t("dashboard:categories.centerLabel")}
                      centerValue={formatMoney(data.expense.amount).replace(/\s?BYN$/, "")}
                      centerUnit={data.expense.amount.currency}
                      segments={[
                        ...data.categories.rows.map((row) => {
                          const ref = categoryRefOf(row.key);
                          const item = ref === undefined ? undefined : lookup.find(ref);
                          return {
                            id: row.key,
                            label: categoryName(row.key),
                            value: row.amount.minor,
                            color: CATEGORY_COLORS[item?.color ?? "other"],
                            valueText: formatMoney(row.amount),
                          };
                        }),
                        ...(data.categories.other === null
                          ? []
                          : [
                              {
                                id: "other",
                                label: t("dashboard:categories.other"),
                                value: data.categories.other.amount.minor,
                                color: CATEGORY_COLORS.other,
                                valueText: formatMoney(data.categories.other.amount),
                              },
                            ]),
                      ]}
                    />
                    <ul className={classes.legend}>
                      {data.categories.rows.map((row) => {
                        const ref = categoryRefOf(row.key);
                        const item = ref === undefined ? undefined : lookup.find(ref);
                        const name = categoryName(row.key);
                        return (
                          <li key={row.key} className={classes.legendRow}>
                            <i
                              className={classes.dot}
                              style={{ background: CATEGORY_COLORS[item?.color ?? "other"] }}
                              aria-hidden
                            />
                            <button
                              type="button"
                              className={classes.legendLink}
                              aria-label={t("dashboard:categories.show", { name })}
                              onClick={() => toOperations(data.period, { category: row.key })}
                            >
                              {name}
                            </button>
                            <Money value={row.amount} tabular />
                            <WhyButton
                              subject={t("dashboard:categories.why", { name })}
                              onClick={() => setTraceId(row.traceId)}
                            />
                          </li>
                        );
                      })}
                      {data.categories.other !== null && (
                        <li className={classes.legendRow}>
                          <i
                            className={classes.dot}
                            style={{ background: CATEGORY_COLORS.other }}
                            aria-hidden
                          />
                          <span className={classes.legendName}>
                            {t("dashboard:categories.other")}{" "}
                            <span className={classes.muted}>
                              ·{" "}
                              {t("dashboard:categories.otherCount", {
                                count: data.categories.other.count,
                              })}
                            </span>
                          </span>
                          <Money value={data.categories.other.amount} tabular />
                          <WhyButton
                            subject={t("dashboard:categories.whyOther")}
                            onClick={() => setTraceId(data.categories.other?.traceId ?? null)}
                          />
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </section>

              <section className={classes.card} aria-labelledby="home-months">
                <h2 id="home-months" className={classes.heading}>
                  {t("dashboard:months.title")}
                </h2>
                <ColumnChart
                  label={t("dashboard:months.label")}
                  {...(data.months.at(-1) === undefined
                    ? {}
                    : { selectedId: data.months.at(-1)?.month ?? "" })}
                  columns={data.months.map((m) => {
                    const name = t(`dashboard:period.months.${m.month.slice(5, 7) as "01"}`);
                    return {
                      id: m.month,
                      label: t(`dashboard:period.monthsShort.${m.month.slice(5, 7) as "01"}`),
                      income: m.income.amount.minor,
                      expense: m.expense.amount.minor,
                      incomeText: t("dashboard:months.income", {
                        month: name.toLowerCase(),
                        amount: formatMoney(m.income.amount),
                      }),
                      expenseText: t("dashboard:months.expense", {
                        month: name.toLowerCase(),
                        amount: formatMoney(m.expense.amount),
                      }),
                    };
                  })}
                  onSelect={(month, kind) => toOperations(monthRange(month), { type: kind })}
                />
                <p className={classes.muted}>{t("dashboard:months.hint")}</p>
                <ul className={classes.whyList}>
                  {data.months.map((m) => {
                    const name = t(
                      `dashboard:period.months.${m.month.slice(5, 7) as "01"}`,
                    ).toLowerCase();
                    return (
                      <li key={m.month} className={classes.whyRow}>
                        <span>{name}</span>
                        <WhyButton
                          subject={t("dashboard:months.whyIncome", { month: name })}
                          onClick={() => setTraceId(m.income.traceId)}
                        />
                        <WhyButton
                          subject={t("dashboard:months.whyExpense", { month: name })}
                          onClick={() => setTraceId(m.expense.traceId)}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>

            <div className={classes.columns}>
              <section className={classes.card} aria-labelledby="home-limits">
                <div className={classes.cardHead}>
                  <h2 id="home-limits" className={classes.heading}>
                    {t("dashboard:limits.title", {
                      month: t(
                        `dashboard:period.months.${data.period.to.slice(5, 7) as "01"}`,
                      ).toLowerCase(),
                    })}
                  </h2>
                  <Link to="/budget" className={classes.link}>
                    {t("dashboard:limits.manage")}
                  </Link>
                </div>
                {data.limits.length === 0 ? (
                  <p className={classes.muted}>
                    {t("dashboard:limits.empty")}{" "}
                    <Link to="/budget" className={classes.link}>
                      {t("dashboard:limits.setUp")}
                    </Link>
                  </p>
                ) : (
                  data.limits.map((limit) => {
                    const name = categoryName(limit.categoryKey);
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
                      <div key={limit.id} className={classes.limit}>
                        <div className={classes.limitHead}>
                          <span>{name}</span>
                          <span className={classes.limitAmounts}>
                            <Money value={limit.spent} />{" "}
                            <span className={classes.muted}>{t("dashboard:limits.of")}</span>{" "}
                            <Money value={limit.limit} />
                          </span>
                          <WhyButton
                            subject={t("dashboard:limits.why", { category: name })}
                            onClick={() => setTraceId(limit.traceId)}
                          />
                        </div>
                        <LimitBar percent={limit.percent} label={name} status={status} />
                      </div>
                    );
                  })
                )}
              </section>

              <section className={classes.card} aria-labelledby="home-goals">
                <div className={classes.cardHead}>
                  <h2 id="home-goals" className={classes.heading}>
                    {t("dashboard:goals.title")}
                  </h2>
                  <Link to="/budget" className={classes.link}>
                    {t("dashboard:goals.all")}
                  </Link>
                </div>
                {data.goals.length === 0 ? (
                  <p className={classes.muted}>
                    {t("dashboard:goals.empty")}{" "}
                    <Link to="/budget" className={classes.link}>
                      {t("dashboard:goals.create")}
                    </Link>
                  </p>
                ) : (
                  data.goals.map((goal) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      variant="compact"
                      onWhy={setTraceId}
                      onContribute={setContributeTo}
                    />
                  ))
                )}
              </section>
            </div>

            <section className={classes.card} aria-labelledby="home-events">
              <div className={classes.cardHead}>
                <h2 id="home-events" className={classes.heading}>
                  {t("calendar:home.title")}
                </h2>
                <Link to="/calendar" className={classes.link}>
                  {t("calendar:home.link")}
                </Link>
              </div>
              {data.events.length === 0 ? (
                <p className={classes.muted}>{t("calendar:home.empty")}</p>
              ) : (
                <ul className={classes.list}>
                  {data.events.map((event) => (
                    <li key={event.id}>
                      <EventRow
                        entry={event}
                        today={data.today}
                        href={`/calendar?event=${encodeURIComponent(event.id)}`}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className={classes.columns}>
              <section className={classes.card} aria-labelledby="home-upcoming">
                <div className={classes.cardHead}>
                  <h2 id="home-upcoming" className={classes.heading}>
                    {t("dashboard:upcoming.title")}
                  </h2>
                  <Link to="/recurring" className={classes.link}>
                    {t("dashboard:upcoming.all")}
                  </Link>
                </div>
                {data.upcoming.length === 0 ? (
                  <p className={classes.muted}>{t("dashboard:upcoming.empty")}</p>
                ) : (
                  <ul className={classes.list}>
                    {data.upcoming.map((payment) => (
                      <li key={`${payment.id}:${payment.on}`} className={classes.row}>
                        <span className={classes.rowName}>{payment.name}</span>
                        <span className={classes.muted}>{formatDate(payment.on)}</span>
                        <Money value={payment.amount} tabular />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className={classes.card} aria-labelledby="home-accounts">
                <div className={classes.cardHead}>
                  <h2 id="home-accounts" className={classes.heading}>
                    {t("dashboard:accounts.title")}
                  </h2>
                  <Link to="/accounts" className={classes.link}>
                    {t("dashboard:accounts.all")}
                  </Link>
                </div>
                <ul className={classes.list}>
                  {data.accounts.items.map((account) => {
                    const name = accountName(account);
                    return (
                      <li key={account.id} className={classes.row}>
                        <span className={classes.rowName}>{name}</span>
                        <Money value={account.balance} tabular />
                        {account.traceId !== null && (
                          <WhyButton
                            subject={t("dashboard:accounts.why", { name })}
                            onClick={() => setTraceId(account.traceId)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </>
        )}
      </div>

      <ContributeDialog
        goal={contributeTo}
        onClose={() => setContributeTo(null)}
        onDone={(result) => {
          setContributeTo(null);
          setNotice(null);
          setToast({
            token: result.undoToken,
            message: t("dashboard:contributed", {
              amount: `${result.amountText} BYN`,
              name: result.goal.name,
            }),
          });
          void refresh();
        }}
      />
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
            setNotice(result.ok ? null : t("dashboard:undoFailed"));
            void refresh();
          }}
        />
      )}
      {found.toast}
    </>
  );
}
