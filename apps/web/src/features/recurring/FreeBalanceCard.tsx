// Свободный остаток на «Регулярных платежах» (design/screens/Recurring.dc.html, FIN-20, FIN-21, EXPL-01): число «в месяц»,
// «по данным за N мес.» и разбивка — средний регулярный доход минус обязательные платежи по группам; ⓘ у каждого числа
// открывает сохранённый расчёт («2 400 − 180 − 35 − 1 200 − 145 = 840 BYN»). Сайт ничего не считает (P1). Нет числа
// (мало истории, нет дохода) — причина словами, а не «0».
import type { FreeBalance } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import type { TraceId } from "@kosht/kernel";
import { Button } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { Formula, Money, SkeletonCard, StatCard, WhyButton } from "../../ui/index.ts";
import classes from "./RecurringPage.module.css";

export function FreeBalanceCard({ onWhy }: { readonly onWhy: (traceId: TraceId) => void }) {
  const { t } = useTranslation("recurring");
  const query = useQuery(orpc.fin.freeBalance.queryOptions({ input: {} }));
  if (query.isPending) return <SkeletonCard />;
  if (query.isError) {
    return (
      <p className={classes.error} role="alert">
        <AlertTriangle size={18} aria-hidden />
        {t("free.error")}
        <Button variant="subtle" onClick={() => void query.refetch()}>
          {t("error.retry")}
        </Button>
      </p>
    );
  }
  return <Content data={query.data} onWhy={onWhy} />;
}

function Content({
  data,
  onWhy,
}: {
  readonly data: FreeBalance;
  readonly onWhy: (traceId: TraceId) => void;
}) {
  const { t } = useTranslation("recurring");
  const why = (traceId: TraceId | null, label: string) =>
    traceId === null ? undefined : <WhyButton subject={label} onClick={() => onWhy(traceId)} />;
  const hint =
    data.freeBalance === null || data.window === null ? (
      t(`free.reasons.${data.reason ?? "insufficient-history"}`)
    ) : (
      <>
        {t("free.text")} {t("free.months", { count: data.months })}.{" "}
        {t("free.window", { from: formatDate(data.window.from), to: formatDate(data.window.to) })}
      </>
    );
  return (
    <section aria-labelledby="rec-free" className={classes.free}>
      <StatCard
        tone="free"
        title={t("free.title")}
        value={
          data.freeBalance === null ? (
            "—"
          ) : (
            <>
              <Money value={data.freeBalance} size="kpi" /> {t("free.perMonth")}
            </>
          )
        }
        hint={hint}
        {...(data.freeBalanceTraceId === null
          ? {}
          : { why: why(data.freeBalanceTraceId, t("free.why")) })}
      />
      {data.freeBalance !== null && (
        <Formula
          rows={[
            {
              id: "income",
              label: t("free.income"),
              value: (
                <>
                  <Money value={data.income} kind="income" tabular />{" "}
                  {why(data.incomeTraceId, t("free.whyIncome"))}
                </>
              ),
            },
            ...data.obligations.map((row) => ({
              id: row.group,
              label: t(`free.groups.${row.group}`),
              value: (
                <>
                  <Money value={row.amount} kind="expense" tabular />{" "}
                  {why(row.traceId, t("free.whyGroup", { group: t(`free.groups.${row.group}`) }))}
                </>
              ),
            })),
          ]}
          total={{
            id: "total",
            label: t("free.total"),
            value: <Money value={data.freeBalance} tabular />,
          }}
        />
      )}
    </section>
  );
}
