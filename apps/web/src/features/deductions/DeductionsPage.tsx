// «Налоговые вычеты» (design/screens/Deductions.dc.html, TAX-01…07, TAX-04, TAX-06, LEGAL-12, PROF-06): тип занятости из профиля,
// калькулятор «Обучение / Жильё / Дети» с результатом (формула, «Откуда эта цифра?», нормы, чек-лист) и «Важно знать».
// Все числа считает сервер по подтверждённой таблице ставок (P1): страница отправляет ввод и показывает ответ. Ответ на вопрос
// о зарплате (TAX-04) сохраняется фактом `income.gross` и сразу пересчитывает расчёт. Найденные по операциям вычеты — T-046.
// Четыре состояния (DES-16): загрузка профиля — скелетон, пусто — «Введите суммы», ошибка расчёта — строка с причиной, успех.
import {
  DeductionKind,
  type CalculateDeductionInput,
  type DeductionResult,
  type EmploymentType,
} from "@kosht/contract";
import { parseMoney } from "@kosht/i18n";
import type { Money as MoneyValue } from "@kosht/kernel";
import { Button, Radio, SegmentedControl, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowLeftRight, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { DeductionResultView, useDeductionTexts } from "../../entities/deduction/index.ts";
import { orpc } from "../../lib/api.ts";
import { PageHeader, SkeletonCard } from "../../ui/index.ts";
import classes from "./DeductionsPage.module.css";
import { DeductionsSearch } from "./model/search.ts";

const KINDS = ["education", "housing", "children"] as const;

export function DeductionsPage({ search }: { readonly search: DeductionsSearch }) {
  useDeductionTexts();
  const { t } = useTranslation(["deductions", "profile"]);
  const navigate = useNavigate();
  const facts = useQuery(orpc.profile.facts.queryOptions());
  const kind = search.kind ?? "education";
  const [result, setResult] = useState<DeductionResult | null>(null);
  const [lastInput, setLastInput] = useState<CalculateDeductionInput | null>(null);
  const [failed, setFailed] = useState(false);
  const queryClient = useQueryClient();
  const calculate = useMutation(
    orpc.tax.calculate.mutationOptions({
      onSuccess: (data) => {
        setFailed(false);
        setResult(data);
      },
      onError: () => setFailed(true),
    }),
  );
  const run = (input: CalculateDeductionInput) => {
    setLastInput(input);
    calculate.mutate(input);
  };
  // TAX-04, PROF-04: ответ — факт профиля; после него расчёт повторяется с теми же суммами.
  const saveGross = useMutation(
    orpc.profile.setFact.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
        if (lastInput !== null) calculate.mutate(lastInput);
      },
    }),
  );

  const types: readonly EmploymentType[] | null =
    facts.data?.facts.flatMap((fact) =>
      fact.value.key === "employment" ? [...fact.value.types] : [],
    ) ?? null;
  const employmentKnown = types !== null && types.length > 0;

  return (
    <>
      <PageHeader title={t("deductions:title")} subtitle={t("deductions:subtitle")} />
      <div className={classes.body}>
        <section className={classes.card} aria-label={t("deductions:profile.change")}>
          {facts.isPending ? (
            <SkeletonCard />
          ) : (
            <p className={classes.profileLine}>
              <ShieldCheck size={18} strokeWidth={1.8} aria-hidden />
              <span>
                {employmentKnown
                  ? t("deductions:profile.employment", {
                      types: types.map((type) => t(`profile:employment.${type}`)).join(", "),
                    })
                  : t("deductions:profile.unknown")}
              </span>
              <Link to="/memory">{t("deductions:profile.change")}</Link>
            </p>
          )}
        </section>

        <section className={classes.card} aria-labelledby="ded-calc">
          <div>
            <h2 className={classes.heading} id="ded-calc">
              {t("deductions:calc.title")}
            </h2>
            <p className={classes.muted}>{t("deductions:calc.hint")}</p>
          </div>
          <SegmentedControl
            aria-label={t("deductions:calc.tabs")}
            value={kind}
            onChange={(value) => {
              setResult(null);
              setFailed(false);
              void navigate({
                to: "/deductions",
                search: DeductionsSearch.parse({
                  kind: value === "education" ? undefined : DeductionKind.parse(value),
                }),
              });
            }}
            data={KINDS.map((value) => ({ value, label: t(`deductions:calc.${value}.tab`) }))}
          />
          <div className={classes.calc}>
            <CalcForm key={kind} kind={kind} pending={calculate.isPending} onSubmit={run} />
            <div aria-live="polite">
              {failed ? (
                <p className={classes.error} role="alert">
                  <AlertCircle size={18} strokeWidth={1.8} aria-hidden />
                  {t("deductions:result.error")}
                </p>
              ) : result === null ? (
                <p className={classes.emptyResult}>
                  <Clock size={18} strokeWidth={1.8} aria-hidden />
                  {t("deductions:result.empty")}
                </p>
              ) : (
                <DeductionResultView
                  result={result}
                  savingGross={saveGross.isPending}
                  grossFailed={saveGross.isError}
                  onSaveGross={(amount) =>
                    saveGross.mutate({ value: { key: "income.gross", amount } })
                  }
                />
              )}
            </div>
          </div>
        </section>

        <section className={classes.card} aria-labelledby="ded-important">
          <h2 className={classes.heading} id="ded-important">
            {t("deductions:important.title")}
          </h2>
          <ul className={classes.important}>
            {(["limit", "carry", "standard", "refund"] as const).map((item) => (
              <li key={item} className={classes.importantItem}>
                {item === "standard" ? (
                  <ArrowLeftRight size={18} strokeWidth={1.8} aria-hidden />
                ) : (
                  <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden />
                )}
                {t(`deductions:important.${item}`)}
              </li>
            ))}
          </ul>
        </section>

        <p className={classes.footer}>
          <span>{t("deductions:footer.disclaimer")}</span>
          <span>{t("deductions:footer.rates")}</span>
          <Link to="/laws">{t("deductions:footer.laws")}</Link>
        </p>
      </div>
    </>
  );
}

/** Форма вида вычета: вход проверяет та же схема контракта, что на сервере; сумма — разбор строки, не расчёт. */
function CalcForm({
  kind,
  pending,
  onSubmit,
}: {
  readonly kind: DeductionKind;
  readonly pending: boolean;
  readonly onSubmit: (input: CalculateDeductionInput) => void;
}) {
  const { t } = useTranslation("deductions");
  const [paid, setPaid] = useState("");
  const [annual, setAnnual] = useState("");
  const [expenses, setExpenses] = useState("");
  const [income, setIncome] = useState("");
  const [basis, setBasis] = useState<"gross" | "net">("gross");

  const money = (text: string): MoneyValue | undefined => {
    const value = parseMoney(text, "BYN");
    return value !== undefined && value.minor > 0 ? value : undefined;
  };
  const invalid = (text: string) => text.trim() !== "" && money(text) === undefined;
  const incomeAmount = money(income);
  const annualAmount = money(annual);
  const incomeInput = incomeAmount === undefined ? {} : { income: { amount: incomeAmount, basis } };

  let input: CalculateDeductionInput | undefined;
  if (kind === "education") {
    const amount = money(paid);
    input =
      amount === undefined
        ? undefined
        : {
            kind: "education",
            paid: amount,
            ...(annualAmount === undefined ? {} : { annualTaxable: annualAmount }),
          };
  } else if (kind === "housing") {
    const amount = money(expenses);
    input =
      amount === undefined ? undefined : { kind: "housing", expenses: amount, ...incomeInput };
  } else {
    input = { kind: "children", ...incomeInput };
  }
  const valid = input !== undefined && !invalid(annual) && !invalid(income);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (input !== undefined && valid) onSubmit(input);
  };

  return (
    <form className={classes.form} onSubmit={submit}>
      {kind === "education" && (
        <>
          <TextInput
            label={t("calc.education.paid")}
            inputMode="decimal"
            value={paid}
            error={invalid(paid) ? t("calc.invalid") : null}
            onChange={(event) => setPaid(event.currentTarget.value)}
          />
          <TextInput
            label={t("calc.education.annual")}
            description={t("calc.education.annualHint")}
            placeholder={t("calc.education.annualPlaceholder")}
            inputMode="decimal"
            value={annual}
            error={invalid(annual) ? t("calc.invalid") : null}
            onChange={(event) => setAnnual(event.currentTarget.value)}
          />
        </>
      )}
      {kind === "housing" && (
        <TextInput
          label={t("calc.housing.expenses")}
          description={t("calc.housing.expensesHint")}
          inputMode="decimal"
          value={expenses}
          error={invalid(expenses) ? t("calc.invalid") : null}
          onChange={(event) => setExpenses(event.currentTarget.value)}
        />
      )}
      {kind === "children" && (
        <p className={classes.muted}>
          {t("calc.children.hint")} <Link to="/memory">{t("calc.children.link")}</Link>
        </p>
      )}
      {kind !== "education" && (
        <>
          <TextInput
            label={t("calc.income")}
            inputMode="decimal"
            value={income}
            error={invalid(income) ? t("calc.invalid") : null}
            onChange={(event) => setIncome(event.currentTarget.value)}
          />
          <Radio.Group
            label={t("calc.housing.basis")}
            value={basis}
            onChange={(value) => setBasis(value === "net" ? "net" : "gross")}
          >
            <div className={classes.fieldset}>
              <Radio value="gross" label={t("calc.housing.gross")} />
              <Radio value="net" label={t("calc.housing.net")} />
            </div>
          </Radio.Group>
        </>
      )}
      <div>
        <Button type="submit" disabled={!valid} loading={pending}>
          {t("calc.submit")}
        </Button>
      </div>
    </form>
  );
}
