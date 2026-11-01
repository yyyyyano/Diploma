// Результат расчёта вычета (TAX-06, CHAT-04): карточка в чате и блок на экране «Налоговые вычеты» — один вид. Суммы, ставка,
// срок и пометки приходят от сервера готовыми (P1): виджет только показывает их; у каждого числа — «Откуда эта цифра?»
// (traceId → сохранённая трасса). Нет значения или вычета нет — честное объяснение причины, а не ноль.
import {
  DEDUCTION_FLAGS,
  type DeductionAmount,
  type DeductionFlag,
  type DeductionResult,
} from "@kosht/contract";
import { deductionsTexts, parseMoney } from "@kosht/i18n";
import type { Money as MoneyValue, TraceId } from "@kosht/kernel";
import { Button, TextInput } from "@mantine/core";
import { AlertTriangle, Info } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Formula, Money, WhyButton } from "../../ui/index.ts";
import { Checklist } from "../checklist/index.ts";
import { ExplanationSheet } from "../explanation/index.ts";
import { CitationQuote } from "../law/index.ts";
import classes from "./DeductionResultView.module.css";

/** Словарь «Налоговых вычетов» — в i18next до первого показа (в первую загрузку сайта он не входит). */
export function useDeductionTexts(): void {
  const { i18n } = useTranslation();
  if (!i18n.hasResourceBundle("ru", "deductions")) {
    i18n.addResourceBundle("ru", "deductions", deductionsTexts, true, true);
  }
}

/** Пометки, которые предупреждают (всё, кроме вопроса и оценки): значок «внимание». */
const WARNING_FLAGS: ReadonlySet<DeductionFlag> = new Set([
  "upper-bound",
  "high-income",
  "income-estimated",
]);

export interface DeductionResultViewProps {
  readonly result: DeductionResult;
  /** Субъект галочек чек-листа: сообщение чата или общий список. */
  readonly checklistSubject?:
    | { readonly kind: "general" }
    | { readonly kind: "message"; readonly id: string };
  /** Ответ на вопрос «какая зарплата до вычета налогов» (TAX-04): страница сохраняет факт `income.gross`; в чате вопрос задаёт агент. */
  readonly onSaveGross?: ((amount: MoneyValue) => void) | undefined;
  readonly savingGross?: boolean;
  readonly grossFailed?: boolean;
  /** Чек-лист и нормы под расчётом (на экране — да, в узкой карточке — тоже). */
  readonly headingLevel?: 3 | 4;
}

export function DeductionResultView({
  result,
  checklistSubject = { kind: "general" },
  onSaveGross,
  savingGross = false,
  grossFailed = false,
  headingLevel = 3,
}: DeductionResultViewProps) {
  useDeductionTexts();
  const { t } = useTranslation(["deductions", "profile"]);
  const [traceId, setTraceId] = useState<TraceId | null>(null);
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;

  if (result.status !== "ok") {
    const reason = result.reason ?? "rate-unconfirmed";
    return (
      <section className={classes.result} aria-labelledby={headingId}>
        <Heading className={classes.title} id={headingId}>
          {t("deductions:result.title")}
        </Heading>
        <p className={classes.problem}>
          <Info size={18} strokeWidth={1.8} aria-hidden />
          {t(`deductions:reasons.${reason}`)}
        </p>
      </section>
    );
  }

  const why = (amount: DeductionAmount | null, subject: string) =>
    amount === null ? null : (
      <WhyButton
        subject={t("deductions:result.why", { subject })}
        onClick={() => setTraceId(amount.traceId)}
      />
    );
  const upperBound = result.flags.includes("upper-bound");
  const kind = result.kind;
  const rows = [
    ...(result.deduction === null
      ? []
      : [
          {
            id: "deduction",
            label: t(`deductions:result.deduction.${kind}`),
            value: <Money value={result.deduction.amount} tabular />,
          },
        ]),
    ...(result.income === null
      ? []
      : [
          {
            id: "income",
            label: t("deductions:result.income"),
            value: <Money value={result.income.amount} tabular />,
          },
        ]),
    ...(result.standard === null
      ? []
      : [
          {
            id: "standard",
            label: t("deductions:result.standard"),
            value: <Money value={result.standard.amount} tabular />,
          },
        ]),
    ...(result.ratePercent === null
      ? []
      : [
          {
            id: "rate",
            label: t("deductions:result.rate"),
            value: `${String(result.ratePercent)} %`,
          },
        ]),
  ];
  const total = kind === "children" ? result.savingMonthly : result.savingTotal;
  const totalLabel =
    kind === "children"
      ? t("deductions:result.saving.childrenMonth")
      : t(
          kind === "housing"
            ? "deductions:result.saving.housing"
            : "deductions:result.saving.education",
        );
  const flags = DEDUCTION_FLAGS.filter(
    (flag) => result.flags.includes(flag) && flag !== "ask-gross",
  );
  const askGross = result.flags.includes("ask-gross");

  return (
    <section className={classes.result} aria-labelledby={headingId}>
      <Heading className={classes.title} id={headingId}>
        {t("deductions:result.title")}
      </Heading>

      <div className={classes.hero}>
        {kind === "children" ? (
          <>
            <p className={classes.heroLabel}>{t("deductions:result.refund")}</p>
            <p className={classes.heroValue}>
              {upperBound && <span className={classes.upTo}>{t("deductions:result.upTo")}</span>}
              {result.savingMonthly !== null && (
                <Money value={result.savingMonthly.amount} size="kpi" />
              )}
              <span className={classes.unit}>{t("deductions:result.perMonth")}</span>
              {why(result.savingMonthly, t("deductions:result.subjects.savingMonth"))}
            </p>
            {result.savingYear !== null && (
              <p className={classes.heroValue}>
                <Money value={result.savingYear.amount} />
                <span className={classes.unit}>{t("deductions:result.perYear")}</span>
                {why(result.savingYear, t("deductions:result.subjects.savingYear"))}
              </p>
            )}
          </>
        ) : (
          <>
            <p className={classes.heroLabel}>{t("deductions:result.refund")}</p>
            <p className={classes.heroValue}>
              <span className={classes.upTo}>{t("deductions:result.upTo")}</span>
              {result.savingTotal !== null && (
                <Money value={result.savingTotal.amount} size="kpi" />
              )}
              {why(result.savingTotal, t("deductions:result.subjects.saving"))}
            </p>
            {kind === "housing" && (
              <p className={classes.pair}>
                {result.savingMonthly !== null && (
                  <span className={classes.pairItem}>
                    <Money value={result.savingMonthly.amount} />
                    <span className={classes.unit}>{t("deductions:result.perMonth")}</span>
                    {why(result.savingMonthly, t("deductions:result.subjects.savingMonth"))}
                  </span>
                )}
                {result.savingYear !== null && (
                  <span className={classes.pairItem}>
                    <Money value={result.savingYear.amount} />
                    <span className={classes.unit}>{t("deductions:result.perYear")}</span>
                    {why(result.savingYear, t("deductions:result.subjects.savingYear"))}
                  </span>
                )}
                {result.term !== null && (
                  <span className={classes.pairItem}>
                    <span className={classes.unit}>{t("deductions:result.term")}</span>
                    <strong>
                      {t(
                        result.term.approx
                          ? "deductions:result.monthsApprox"
                          : "deductions:result.months",
                        { months: result.term.months },
                      )}
                    </strong>
                    <WhyButton
                      subject={t("deductions:result.why", {
                        subject: t("deductions:result.subjects.term"),
                      })}
                      onClick={() => setTraceId(result.term?.traceId ?? null)}
                    />
                  </span>
                )}
              </p>
            )}
          </>
        )}
      </div>

      {total !== null && rows.length > 0 && (
        <Formula
          rows={rows}
          total={{
            id: "total",
            label: totalLabel,
            value: <Money value={total.amount} tabular />,
          }}
        />
      )}

      <ul className={classes.notes}>
        {result.carryOver !== null && (
          <li className={classes.note}>
            <Info size={16} strokeWidth={1.8} aria-hidden />
            <span>
              {t("deductions:result.carryOver")} <Money value={result.carryOver.amount} />
            </span>
          </li>
        )}
        {result.termReason !== null && (
          <li className={classes.note}>
            <Info size={16} strokeWidth={1.8} aria-hidden />
            {t(
              result.termReason === "no-income"
                ? "deductions:result.noIncome"
                : "deductions:result.noTaxable",
            )}
          </li>
        )}
        {result.children !== null && (
          <li className={classes.note}>
            <Info size={16} strokeWidth={1.8} aria-hidden />
            {t("deductions:result.children.count", { count: result.children.count })}.{" "}
            {t(
              result.children.increased
                ? "deductions:result.children.increased"
                : "deductions:result.children.regular",
            )}
          </li>
        )}
        {flags.map((flag) => (
          <li
            key={flag}
            className={`${classes.note} ${WARNING_FLAGS.has(flag) ? classes.warn : ""}`}
          >
            {WARNING_FLAGS.has(flag) ? (
              <AlertTriangle size={16} strokeWidth={1.8} aria-hidden />
            ) : (
              <Info size={16} strokeWidth={1.8} aria-hidden />
            )}
            <span>{t(`deductions:flags.${flag}`)}</span>
          </li>
        ))}
        {askGross && (
          <li className={classes.note}>
            <Info size={16} strokeWidth={1.8} aria-hidden />
            <span>{t("deductions:flags.ask-gross")}</span>
          </li>
        )}
      </ul>

      {askGross && onSaveGross !== undefined && (
        <GrossForm onSave={onSaveGross} pending={savingGross} failed={grossFailed} />
      )}

      {result.ways.length > 0 && (
        <div>
          <h4 className={classes.heading}>{t("deductions:ways.title")}</h4>
          <ul className={classes.ways}>
            {result.ways.map((way) => (
              <li key={way}>{t(`deductions:ways.${way}`)}</li>
            ))}
          </ul>
        </div>
      )}

      {result.citations.length > 0 && (
        <details>
          <summary className={classes.summary}>{t("deductions:norms.title")}</summary>
          <div className={classes.quotes}>
            {result.citations.map((citation) =>
              citation.kind === "quote" ? (
                <CitationQuote key={citation.versionId} citation={citation} />
              ) : null,
            )}
          </div>
        </details>
      )}

      <Checklist id={result.checklistId} subject={checklistSubject} />

      {traceId !== null && (
        <ExplanationSheet traceId={traceId} opened onClose={() => setTraceId(null)} />
      )}
    </section>
  );
}

/** Вопрос TAX-04: зарплата до вычета налогов; ответ сохраняется фактом профиля и пересчитывает расчёт. */
function GrossForm({
  onSave,
  pending,
  failed,
}: {
  readonly onSave: (amount: MoneyValue) => void;
  readonly pending: boolean;
  readonly failed: boolean;
}) {
  const { t } = useTranslation("deductions");
  const [text, setText] = useState("");
  const parsed = parseMoney(text, "BYN");
  const valid = parsed !== undefined && parsed.minor > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSave(parsed);
  };
  return (
    <form className={classes.grossForm} onSubmit={submit}>
      <TextInput
        className={classes.grossField}
        label={t("gross.label")}
        inputMode="decimal"
        value={text}
        error={text !== "" && !valid ? t("gross.invalid") : null}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <Button type="submit" disabled={!valid} loading={pending}>
        {t("gross.save")}
      </Button>
      {failed && (
        <p className={classes.error} role="alert">
          {t("gross.error")}
        </p>
      )}
    </form>
  );
}
