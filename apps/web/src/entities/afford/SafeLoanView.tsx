// Безопасный платёж по кредиту (AFF-05, AFF-06): карточка в чате и блок на экране — один вид. Предел ПДН, платёж и сумма кредита
// приходят от сервера готовыми (P1); у каждого числа — «Откуда эта цифра?». Предел не подтверждён — честное «нет предела», а не
// ноль. Названий банков и программ нет (P6); доход — оценка по выпискам, банк считает ПДН по своей методике.
import type { SafeLoanResult } from "@kosht/contract";
import { parseMoney } from "@kosht/i18n";
import type { Money as MoneyValue, TraceId } from "@kosht/kernel";
import { Button, TextInput } from "@mantine/core";
import { AlertTriangle, Info, ShieldCheck } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Formula, Money, WhyButton } from "../../ui/index.ts";
import { ExplanationSheet } from "../explanation/index.ts";
import classes from "./afford.module.css";
import { useAffordTexts } from "./texts.ts";

export interface SafeLoanViewProps {
  readonly result: SafeLoanResult;
  /** Ответ на «регулярный доход не найден»: страница пересчитывает; в чате вопрос задаёт агент. */
  readonly onIncome?: ((income: MoneyValue) => void) | undefined;
  readonly incomePending?: boolean;
  /** Поля ставки и срока и переключатель типа кредита — страница вставляет их между доходом и итогом. */
  readonly controls?: ReactNode;
  readonly headingLevel?: 2 | 3;
}

export function SafeLoanView({
  result,
  onIncome,
  incomePending = false,
  controls,
  headingLevel = 2,
}: SafeLoanViewProps) {
  useAffordTexts();
  const { t } = useTranslation("afford");
  const [traceId, setTraceId] = useState<TraceId | null>(null);
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  const why = (amount: { readonly traceId: TraceId } | null, subject: string) =>
    amount === null ? null : (
      <WhyButton subject={subject} onClick={() => setTraceId(amount.traceId)} />
    );
  const percent = result.limitPercent;

  return (
    <section className={classes.loan} aria-labelledby={headingId}>
      <div className={classes.resultHead}>
        <Heading className={classes.title} id={headingId}>
          {t("loan.title")}
        </Heading>
        <span className={classes.pill}>{t("loan.badge")}</span>
      </div>
      <p className={classes.muted}>
        {percent === null ? t("loan.hintUnknown") : t("loan.hint", { percent })}
      </p>

      <div className={classes.loanGrid}>
        <div className={classes.loanFacts}>
          {result.income !== null && (
            <div className={classes.fact}>
              <p className={classes.kpiLabel}>{t("loan.income")}</p>
              <p className={classes.factValue}>
                <Money value={result.income.amount} tabular />
                {why(result.income, t("loan.subjects.income"))}
              </p>
              <p className={classes.muted}>
                {t(result.incomeSource === "user" ? "loan.incomeUser" : "loan.incomeHistory")}
              </p>
            </div>
          )}
          {result.currentPayments !== null && (
            <div className={classes.fact}>
              <p className={classes.kpiLabel}>{t("loan.current")}</p>
              <p className={classes.factValue}>
                <Money value={result.currentPayments.amount} tabular />
                {why(result.currentPayments, t("loan.subjects.current"))}
              </p>
              {result.currentPayments.amount.minor === 0 && (
                <p className={classes.muted}>{t("loan.currentNone")}</p>
              )}
            </div>
          )}
        </div>

        <div className={classes.loanResult}>
          {result.status === "no-limit" && (
            <p className={classes.problem}>
              <Info size={18} strokeWidth={1.8} aria-hidden />
              {t("loan.noLimit")}
            </p>
          )}
          {result.status === "no-income" && (
            <>
              <p className={classes.problem}>
                <Info size={18} strokeWidth={1.8} aria-hidden />
                {t("loan.noIncome")}
              </p>
              {onIncome !== undefined && <IncomeForm onSubmit={onIncome} pending={incomePending} />}
            </>
          )}
          {result.status === "ok" && result.exceeded && (
            <p className={classes.problem}>
              <AlertTriangle size={18} strokeWidth={1.8} aria-hidden />
              {t("loan.exceeded")}
            </p>
          )}
          {result.safePayment !== null && (
            <>
              <p className={classes.kpiLabel}>{t("loan.safe")}</p>
              <p className={classes.kpiValue}>
                <Money value={result.safePayment.amount} size="kpi" />
                <span className={classes.unit}>{t("loan.perMonth")}</span>
                {why(result.safePayment, t("loan.subjects.safe"))}
              </p>
              {result.income !== null &&
                result.limitAmount !== null &&
                result.currentPayments !== null && (
                  <Formula
                    rows={[
                      {
                        id: "limit",
                        label: (
                          <>
                            {t("loan.formulaLimit", { percent: percent ?? "" })}{" "}
                            {why(result.limitAmount, t("loan.subjects.limit"))}
                          </>
                        ),
                        value: <Money value={result.limitAmount.amount} tabular />,
                      },
                      {
                        id: "current",
                        label: t("loan.formulaCurrent"),
                        value: <Money value={result.currentPayments.amount} tabular />,
                      },
                    ]}
                    total={{
                      id: "safe",
                      label: t("loan.formulaTotal"),
                      value: <Money value={result.safePayment.amount} tabular />,
                    }}
                  />
                )}
              {result.maxLoan === null ? (
                <p className={classes.muted}>{t("loan.askRateTerm")}</p>
              ) : (
                <p className={classes.maxLoan}>
                  <span>
                    {t("loan.maxLoan", {
                      rate: formatRate(result.maxLoan.rateBp),
                      months: result.maxLoan.months,
                    })}
                  </span>
                  <strong>
                    <Money value={result.maxLoan.amount.amount} tabular />
                  </strong>
                  {why(result.maxLoan.amount, t("loan.subjects.maxLoan"))}
                </p>
              )}
            </>
          )}
          <p className={classes.disclaimer}>
            <ShieldCheck size={16} strokeWidth={1.8} aria-hidden />
            {t("loan.disclaimer")}
          </p>
        </div>
      </div>

      {controls}

      {traceId !== null && (
        <ExplanationSheet traceId={traceId} opened onClose={() => setTraceId(null)} />
      )}
    </section>
  );
}

/** Ставка из сотых долей процента в текст: 1400 → «14», 1450 → «14,5», 1405 → «14,05» (разбор строки, не расчёт). */
export function formatRate(bp: number): string {
  const text = String(bp).padStart(3, "0");
  const whole = text.slice(0, -2);
  const fraction = text.slice(-2).replace(/0+$/u, "");
  return fraction === "" ? whole : `${whole},${fraction}`;
}

/** Вопрос «доход не найден» (AFF-08): доход «на руки» в месяц называет человек, расчёт — по его слову. */
function IncomeForm({
  onSubmit,
  pending,
}: {
  readonly onSubmit: (income: MoneyValue) => void;
  readonly pending: boolean;
}) {
  const { t } = useTranslation("afford");
  const [text, setText] = useState("");
  const parsed = parseMoney(text, "BYN");
  const valid = parsed !== undefined && parsed.minor > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSubmit(parsed);
  };
  return (
    <form className={classes.incomeForm} onSubmit={submit}>
      <TextInput
        label={t("loan.incomeLabel")}
        inputMode="decimal"
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <Button type="submit" disabled={!valid} loading={pending}>
        {t("loan.incomeSubmit")}
      </Button>
    </form>
  );
}
