// Результат сценариев покупки (AFF-03, AFF-04, AFF-07, AFF-08): карточка в чате и блок на экране — один вид. Суммы, даты и сроки
// приходят от сервера готовыми (P1): виджет только показывает их; у каждого числа — «Откуда эта цифра?» (traceId → сохранённый
// расчёт). Нет расчёта — причина словами, а не ноль. Названий банков и программ в результате нет (P6).
import type { AffordAmount, AffordResult, AffordScenario } from "@kosht/contract";
import { formatDate, formatMoney, parseMoney } from "@kosht/i18n";
import type { Money as MoneyValue, TraceId } from "@kosht/kernel";
import { Button, TextInput } from "@mantine/core";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Info,
  PiggyBank,
  ShieldCheck,
} from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../../ui/cx.ts";
import { Money, StatusBadge, WhyButton } from "../../ui/index.ts";
import { ExplanationSheet } from "../explanation/index.ts";
import { AffordChart } from "./AffordChart.tsx";
import classes from "./afford.module.css";
import { useAffordTexts } from "./texts.ts";

export interface AffordResultViewProps {
  readonly result: AffordResult;
  /** Название покупки из формы: «Ноутбук за 3 000,00 BYN». */
  readonly name?: string;
  /** Ответ на «регулярный доход не найден» (AFF-08): страница пересчитывает с названным доходом; в чате вопрос задаёт агент. */
  readonly onIncome?: ((income: MoneyValue, on: string) => void) | undefined;
  readonly incomePending?: boolean;
  readonly headingLevel?: 2 | 3;
}

const TITLES = {
  now: "scenario.now.title",
  "after-income": "scenario.afterIncome.title",
  save: "scenario.save.title",
} as const;

export function AffordResultView({
  result,
  name,
  onIncome,
  incomePending = false,
  headingLevel = 2,
}: AffordResultViewProps) {
  useAffordTexts();
  const { t } = useTranslation("afford");
  const [traceId, setTraceId] = useState<TraceId | null>(null);
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  const why = (amount: { readonly traceId: TraceId } | null, subject: string) =>
    amount === null ? null : (
      <WhyButton subject={subject} onClick={() => setTraceId(amount.traceId)} />
    );
  const price = formatMoney(result.price);
  const { considered } = result;
  const amountChip = (
    label: string,
    amount: AffordAmount,
    suffix: string | null,
    subject: string,
  ) => (
    <li className={classes.chip}>
      <span>{label}</span>
      <strong>
        <Money value={amount.amount} tabular />
      </strong>
      {suffix !== null && <span>{suffix}</span>}
      {why(amount, subject)}
    </li>
  );

  return (
    <section className={classes.result} aria-labelledby={headingId}>
      <div className={classes.resultHead}>
        <Heading className={classes.title} id={headingId}>
          {name === undefined || name.trim() === ""
            ? t("result.headingNoName", { amount: price })
            : t("result.heading", { name: name.trim(), amount: price })}
        </Heading>
        {result.estimate && (
          <StatusBadge tone="neutral" icon={Info}>
            {t("result.estimate")}
          </StatusBadge>
        )}
      </div>
      {result.estimate && <p className={classes.muted}>{t("result.estimateHint")}</p>}

      {result.needs.includes("income") && onIncome !== undefined && (
        <NeedsIncome onSubmit={onIncome} pending={incomePending} />
      )}

      <div className={classes.consideredBlock}>
        <p className={classes.consideredLabel}>{t("result.considered")}</p>
        <ul className={classes.chips}>
          {amountChip(
            t("result.available"),
            considered.available,
            null,
            t("result.subjects.available"),
          )}
          {considered.dailySpend !== null &&
            amountChip(
              t("result.dailySpend"),
              considered.dailySpend,
              t("result.perDay"),
              t("result.subjects.dailySpend"),
            )}
          {considered.monthlyIncome !== null &&
            amountChip(
              t("result.income"),
              considered.monthlyIncome,
              t("result.perMonth"),
              t("result.subjects.income"),
            )}
          {considered.monthlyObligations !== null &&
            amountChip(
              t("result.obligations"),
              considered.monthlyObligations,
              t("result.perMonth"),
              t("result.subjects.obligations"),
            )}
        </ul>
        {considered.unconverted.length > 0 && (
          <p className={classes.warning}>
            <AlertTriangle size={16} strokeWidth={1.8} aria-hidden />
            {t("result.unconverted", { names: considered.unconverted.join(", ") })}
          </p>
        )}
        {result.unpriced.map((item) => (
          <p key={`${item.type}-${item.rule ?? ""}-${item.on}`} className={classes.warning}>
            <AlertTriangle size={16} strokeWidth={1.8} aria-hidden />
            {t(item.type === "tax" ? "result.unpriced.tax" : "result.unpriced.insurance", {
              date: formatDate(item.on),
            })}
          </p>
        ))}
      </div>

      <div className={classes.scenarios}>
        {result.scenarios.map((scenario, index) => (
          <ScenarioCard
            key={scenario.kind}
            scenario={scenario}
            order={index + 1}
            why={why}
            headingLevel={headingLevel === 2 ? 3 : 4}
          />
        ))}
      </div>

      <section className={classes.chartCard} aria-label={t("chart.title")}>
        <div>
          <h3 className={classes.cardTitle}>{t("chart.title")}</h3>
          <p className={classes.muted}>
            {t("chart.subtitle", {
              from: formatDate(result.horizon.from),
              to: formatDate(result.horizon.to),
            })}
          </p>
        </div>
        <AffordChart result={result} />
      </section>

      {traceId !== null && (
        <ExplanationSheet traceId={traceId} opened onClose={() => setTraceId(null)} />
      )}
    </section>
  );
}

function ScenarioCard({
  scenario,
  order,
  why,
  headingLevel,
}: {
  readonly scenario: AffordScenario;
  readonly order: number;
  readonly why: (amount: { readonly traceId: TraceId } | null, subject: string) => ReactNode;
  readonly headingLevel: 3 | 4;
}) {
  const { t } = useTranslation("afford");
  const Heading = `h${headingLevel}` as const;
  const subtitle =
    scenario.kind === "now" && scenario.on !== null
      ? t("scenario.now.subtitle", { date: formatDate(scenario.on) })
      : scenario.kind === "after-income" && scenario.on !== null
        ? t("scenario.afterIncome.subtitle", { date: formatDate(scenario.on) })
        : scenario.kind === "save"
          ? t("scenario.save.subtitle")
          : null;
  const unavailable = scenario.status === "unavailable";
  const risky = scenario.risk !== null;
  const badge = unavailable ? (
    <StatusBadge tone="neutral" icon={Info}>
      {t("scenario.badge.unavailable")}
    </StatusBadge>
  ) : risky ? (
    <StatusBadge tone="danger" icon={CircleAlert}>
      {t("scenario.badge.risk")}
    </StatusBadge>
  ) : (
    <StatusBadge tone="ok" icon={CheckCircle2}>
      {t("scenario.badge.ok")}
    </StatusBadge>
  );

  return (
    <article className={cx(classes.scenario, scenario.recommended && classes.recommended)}>
      <header className={classes.scenarioHead}>
        <span className={classes.order} aria-hidden>
          {order}
        </span>
        <div>
          <Heading className={classes.cardTitle}>{t(TITLES[scenario.kind])}</Heading>
          {subtitle !== null && <p className={classes.muted}>{subtitle}</p>}
        </div>
      </header>
      <div className={classes.badges}>
        {badge}
        {scenario.recommended && (
          <StatusBadge tone="brand" icon={ShieldCheck}>
            {t("scenario.badge.recommended")}
          </StatusBadge>
        )}
      </div>

      {unavailable && scenario.reason !== null && scenario.saving === null && (
        <p className={classes.muted}>{t(`scenario.unavailable.${scenario.reason}`)}</p>
      )}

      {scenario.lowest !== null && (
        <div className={classes.kpi}>
          <p className={classes.kpiLabel}>
            {t("scenario.lowest")} {why(scenario.lowest.amount, t("result.subjects.lowest"))}
          </p>
          <p
            className={cx(
              classes.kpiValue,
              scenario.lowest.amount.amount.minor < 0 && classes.negative,
            )}
          >
            <Money value={scenario.lowest.amount.amount} size="kpi" />
          </p>
          <p className={classes.muted}>{formatDate(scenario.lowest.on)}</p>
        </div>
      )}

      {scenario.saving !== null && (
        <div className={classes.kpi}>
          <p className={classes.kpiLabel}>
            {t("scenario.saving")} {why(scenario.saving.monthly, t("result.subjects.saving"))}
          </p>
          <p className={classes.kpiValue}>
            <Money value={scenario.saving.monthly.amount} size="kpi" />
          </p>
          {scenario.saving.months !== null && scenario.saving.readyOn !== null ? (
            <p className={classes.muted}>
              {t("scenario.ready", {
                date: formatDate(scenario.saving.readyOn),
                months: scenario.saving.months.value,
              })}{" "}
              {why(scenario.saving.months, t("result.subjects.months"))}
            </p>
          ) : (
            <p className={classes.muted}>{t("scenario.noSurplus")}</p>
          )}
        </div>
      )}

      {scenario.kind !== "save" && scenario.status === "ok" && (
        <ul className={classes.messages}>
          {scenario.risk === null ? (
            <>
              <li className={classes.good}>
                <CheckCircle2 size={16} strokeWidth={1.8} aria-hidden />
                {t("scenario.covered")}
              </li>
              <li className={classes.good}>
                <CheckCircle2 size={16} strokeWidth={1.8} aria-hidden />
                {t("scenario.goalsStay")}
              </li>
            </>
          ) : (
            <>
              <li className={classes.bad}>
                <CircleAlert size={16} strokeWidth={1.8} aria-hidden />
                <span>
                  {t("scenario.risk", {
                    first: formatDate(scenario.risk.firstOn),
                    amount: formatMoney(scenario.risk.shortfall.amount),
                    lowest: formatDate(scenario.risk.lowestOn),
                  })}{" "}
                  {why(scenario.risk.shortfall, t("result.subjects.shortfall"))}
                </span>
              </li>
              <li className={classes.warn}>
                <PiggyBank size={16} strokeWidth={1.8} aria-hidden />
                <span>
                  {scenario.goal === null
                    ? t("scenario.goalUncovered")
                    : t("scenario.goalShift", {
                        amount: formatMoney(scenario.goal.taken),
                        name: scenario.goal.name,
                        months: scenario.goal.shiftMonths.value,
                      })}{" "}
                  {scenario.goal !== null &&
                    why(scenario.goal.shiftMonths, t("result.subjects.goalShift"))}
                </span>
              </li>
            </>
          )}
        </ul>
      )}
    </article>
  );
}

/** AFF-08: регулярного дохода нет — ожидаемый доход и день поступления называет человек; ответ пересчитывает сценарии. */
function NeedsIncome({
  onSubmit,
  pending,
}: {
  readonly onSubmit: (income: MoneyValue, on: string) => void;
  readonly pending: boolean;
}) {
  const { t } = useTranslation("afford");
  const [text, setText] = useState("");
  const [day, setDay] = useState("");
  const income = parseMoney(text, "BYN");
  const valid = income !== undefined && income.minor > 0 && /^\d{4}-\d{2}-\d{2}$/u.test(day);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSubmit(income, day);
  };
  return (
    <form className={classes.needs} onSubmit={submit}>
      <p className={classes.needsTitle}>
        <Info size={18} strokeWidth={1.8} aria-hidden />
        {t("needs.title")}
      </p>
      <p className={classes.muted}>{t("needs.hint")}</p>
      <div className={classes.needsFields}>
        <TextInput
          label={t("needs.income")}
          inputMode="decimal"
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <TextInput
          label={t("needs.day")}
          type="date"
          value={day}
          onChange={(event) => setDay(event.currentTarget.value)}
        />
        <Button type="submit" disabled={!valid} loading={pending}>
          {t("needs.submit")}
        </Button>
      </div>
    </form>
  );
}
