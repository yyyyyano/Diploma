// Карточка «Итоги недели» на главной (design/screens/Main.dc.html .wk, WEEK-01, DASH-02): текст сводки и три числа — траты недели,
// самая затратная категория, платежи ближайших семи дней. Числа и текст приходят от сервера готовыми (P1): текст писала модель по
// готовым числам или шаблон; у каждого числа — «Откуда эта цифра?» (traceId → сохранённый расчёт).
import type { WeeklySummary } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import type { TraceId } from "@kosht/kernel";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Money, WhyButton } from "../../ui/index.ts";
import { ExplanationSheet } from "../explanation/index.ts";
import classes from "./WeeklyCard.module.css";
import { useWeeklyTexts } from "./texts.ts";

export function WeeklyCard({ summary }: { readonly summary: WeeklySummary }) {
  useWeeklyTexts();
  const { t } = useTranslation("weekly");
  const [traceId, setTraceId] = useState<TraceId | null>(null);
  const headingId = useId();
  const top = summary.categories[0];
  const why = (id: TraceId, subject: string) => (
    <WhyButton subject={subject} onClick={() => setTraceId(id)} />
  );
  const items = summary.upcoming.items.flatMap((item) =>
    item.title === null ? [] : [`${item.title} ${formatDate(item.on).slice(0, 5)}`],
  );

  return (
    <section className={classes.card} aria-labelledby={headingId}>
      <div className={classes.head}>
        <div>
          <p className={classes.eyebrow}>
            {t("card.period", {
              from: formatDate(summary.weekStart),
              to: formatDate(summary.weekEnd),
            })}
          </p>
          <h2 className={classes.title} id={headingId}>
            {t("card.title")}
          </h2>
        </div>
        {why(summary.spent.traceId, t("card.subjects.spent"))}
      </div>
      <p className={classes.text}>{summary.text}</p>
      <div className={classes.stats}>
        <div className={classes.stat}>
          <p className={classes.label}>{t("card.spent")}</p>
          <p className={classes.value}>
            <Money value={summary.spent.amount} tabular />
          </p>
          {summary.average !== null && (
            <p className={classes.label}>
              {t("card.average")} <Money value={summary.average.amount} tabular />{" "}
              {why(summary.average.traceId, t("card.subjects.average"))}
            </p>
          )}
        </div>
        {top !== undefined && (
          <div className={classes.stat}>
            <p className={classes.label}>{t("card.categories")}</p>
            <p className={classes.value}>{top.name}</p>
            <p className={classes.label}>
              <Money value={top.amount.amount} tabular />{" "}
              {why(top.amount.traceId, t("card.subjects.category", { name: top.name }))}
            </p>
          </div>
        )}
        {summary.upcoming.payments !== null && (
          <div className={classes.stat}>
            <p className={classes.label}>{t("card.upcoming")}</p>
            <p className={classes.value}>
              <Money value={summary.upcoming.payments.amount} tabular />{" "}
              {why(summary.upcoming.payments.traceId, t("card.subjects.payments"))}
            </p>
            {items.length > 0 && <p className={classes.label}>{items.join(", ")}</p>}
          </div>
        )}
      </div>
      <p className={classes.source}>
        {t(summary.textSource === "model" ? "card.sourceModel" : "card.sourceTemplate")}
      </p>
      {traceId !== null && (
        <ExplanationSheet traceId={traceId} opened onClose={() => setTraceId(null)} />
      )}
    </section>
  );
}
