// «Могу ли я позволить покупку?» (design/screens/Afford.dc.html, AFF-01…08): форма «что и когда», три сценария с прогнозом остатка по
// дням и безопасный платёж по ПДН. Все числа считает сервер (P1): страница отправляет сумму и день, ползунок и быстрые суммы
// пересчитывают сценарии на сервере с задержкой в 400 мс, ответ показывает общий вид `entities/afford` (он же карточка в чате). Четыре
// состояния (DES-16): пусто («введите сумму»), загрузка, ошибка с «Повторить», результат. Расчёт ничего не создаёт, кроме
// сохранённых трасс «Откуда эта цифра?» (одинаковый расчёт — те же id).
import type { AffordInput, SafeLoanInput } from "@kosht/contract";
import { formatDate, formatMoney, parseMoney } from "@kosht/i18n";
import type { Money as MoneyValue } from "@kosht/kernel";
import { Button, Slider, TextInput, Switch, SegmentedControl } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { AlertCircle, Calculator, ShoppingBag } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AffordResultView, SafeLoanView, useAffordTexts } from "../../entities/afford/index.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { orpc } from "../../lib/api.ts";
import { EmptyState, PageHeader, SkeletonCard } from "../../ui/index.ts";
import classes from "./AffordPage.module.css";
import { parseMonths, parseRateBp } from "./model/percent.ts";
import type { AffordSearch } from "./model/search.ts";

/** Быстрые суммы формы (макет): рубли — подставляются в поле как есть, расчёт — на сервере. */
const QUICK = ["1500", "3000", "5000"] as const;
const SLIDER_MAX = 20_000;
const DEBOUNCE_MS = 400;

const quickLabel = (rubles: string): string => {
  const money = parseMoney(rubles, "BYN");
  return money === undefined ? rubles : formatMoney(money).replace(/,00 BYN$/u, "");
};

export function AffordPage({ search }: { readonly search: AffordSearch }) {
  useAffordTexts();
  const { t } = useTranslation(["afford", "errors"]);
  const [name, setName] = useState("");
  const [sumText, setSumText] = useState(search.sum ?? "");
  const [when, setWhen] = useState<"now" | "other">("now");
  const [day, setDay] = useState("");
  const [income, setIncome] = useState<{ amount: MoneyValue; on: string } | null>(null);

  const price = parseMoney(sumText, "BYN");
  const priceValid = price !== undefined && price.minor > 0;
  const dayValid = when === "now" || /^\d{4}-\d{2}-\d{2}$/u.test(day);
  const inputKey = JSON.stringify([
    priceValid ? price : null,
    when === "other" && dayValid ? day : null,
    income,
  ]);
  const input = useMemo<AffordInput | null>(
    () =>
      priceValid && dayValid
        ? {
            price,
            ...(when === "other" ? { on: day } : {}),
            ...(income === null
              ? {}
              : { expectedIncome: income.amount, expectedIncomeOn: income.on }),
          }
        : null,
    // Состав входа определяет `inputKey`: объект пересоздаётся только при смене значений.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ключ вместо самих значений
    [inputKey],
  );
  const [committed] = useDebouncedValue(input, DEBOUNCE_MS);
  const scenarios = useQuery({
    ...orpc.afford.scenarios.queryOptions({ input: committed ?? skipToken }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const rubles = /^\d+$/u.test(sumText.trim()) ? Number(sumText.trim()) : 0;

  const failedCode = scenarios.isError ? errorCodeOf(scenarios.error) : null;
  const dayError =
    failedCode === "VALIDATION" && scenarios.isError
      ? errorParamsOf(scenarios.error)["field"] === "on"
      : false;
  const today = scenarios.data?.today;

  return (
    <>
      <PageHeader title={t("afford:title")} subtitle={t("afford:subtitle")} />
      <div className={classes.body}>
        <section className={classes.card} aria-labelledby="aff-form">
          <h2 className={classes.heading} id="aff-form">
            {t("afford:form.title")}
          </h2>
          <div className={classes.form}>
            <TextInput
              label={t("afford:form.name")}
              placeholder={t("afford:form.namePlaceholder")}
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <div className={classes.sumField}>
              <TextInput
                label={t("afford:form.sum")}
                placeholder={t("afford:form.sumPlaceholder")}
                inputMode="decimal"
                value={sumText}
                error={sumText.trim() !== "" && !priceValid ? t("afford:form.invalid") : null}
                onChange={(event) => setSumText(event.currentTarget.value)}
              />
              <fieldset className={classes.quick} aria-label={t("afford:form.quick")}>
                {QUICK.map((value) => (
                  <Button
                    key={value}
                    variant={sumText.trim() === value ? "light" : "default"}
                    size="xs"
                    radius="xl"
                    onClick={() => setSumText(value)}
                  >
                    {quickLabel(value)}
                  </Button>
                ))}
              </fieldset>
              <Slider
                thumbLabel={t("afford:form.slider")}
                min={0}
                max={SLIDER_MAX}
                step={100}
                value={Math.min(rubles, SLIDER_MAX)}
                label={null}
                onChange={(value) => setSumText(value === 0 ? "" : String(value))}
              />
            </div>
            <div className={classes.whenField}>
              <SegmentedControl
                aria-label={t("afford:form.when")}
                value={when}
                onChange={(value) => setWhen(value === "other" ? "other" : "now")}
                data={[
                  { value: "now", label: t("afford:form.now") },
                  { value: "other", label: t("afford:form.other") },
                ]}
              />
              {when === "other" ? (
                <TextInput
                  label={t("afford:form.day")}
                  type="date"
                  value={day}
                  error={
                    dayError
                      ? t("afford:form.dayError", {
                          to:
                            scenarios.data === undefined
                              ? ""
                              : formatDate(scenarios.data.horizon.to),
                        })
                      : null
                  }
                  onChange={(event) => setDay(event.currentTarget.value)}
                />
              ) : (
                today !== undefined && (
                  <p className={classes.muted}>
                    {t("afford:form.today", { date: formatDate(today) })}
                  </p>
                )
              )}
            </div>
          </div>
        </section>

        <div aria-live="polite">
          {committed === null && input === null && (
            <EmptyState
              icon={ShoppingBag}
              title={t("afford:state.empty")}
              description={null}
              headingLevel={2}
            />
          )}
          {scenarios.isPending && committed !== null && (
            <>
              <p className={classes.muted}>{t("afford:state.loading")}</p>
              <SkeletonCard />
            </>
          )}
          {scenarios.isError && !dayError && (
            <EmptyState
              tone="error"
              icon={AlertCircle}
              title={t("afford:state.error")}
              description={null}
              actions={
                <Button onClick={() => void scenarios.refetch()}>{t("afford:state.retry")}</Button>
              }
            />
          )}
          {scenarios.data !== undefined && (
            <AffordResultView
              result={scenarios.data}
              name={name}
              incomePending={scenarios.isFetching}
              onIncome={(amount, on) => setIncome({ amount, on })}
            />
          )}
        </div>

        <LoanSection />
      </div>
    </>
  );
}

/** Блок «Безопасный платёж по кредиту» (AFF-05): тип кредита, ставка и срок — на сервер; расчёт — ответ. */
function LoanSection() {
  const { t } = useTranslation("afford");
  const [domestic, setDomestic] = useState(false);
  const [rateText, setRateText] = useState("");
  const [termText, setTermText] = useState("36");
  const [income, setIncome] = useState<MoneyValue | null>(null);
  const rate = parseRateBp(rateText);
  const months = parseMonths(termText);
  const input: SafeLoanInput = {
    ...(domestic ? { domesticGoods: true } : {}),
    ...(rate !== undefined && months !== undefined ? { rateBp: rate, months } : {}),
    ...(income === null ? {} : { income }),
  };
  const key = JSON.stringify(input);
  const stable = useMemo<SafeLoanInput>(
    () => input,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ключ вместо самих значений
    [key],
  );
  const [committed] = useDebouncedValue(stable, DEBOUNCE_MS);
  const loan = useQuery({
    ...orpc.afford.safeLoan.queryOptions({ input: committed }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  return (
    <>
      {loan.isPending && <SkeletonCard />}
      {loan.isError && (
        <EmptyState
          tone="error"
          icon={Calculator}
          title={t("loan.error")}
          description={null}
          actions={<Button onClick={() => void loan.refetch()}>{t("state.retry")}</Button>}
        />
      )}
      {loan.data !== undefined && (
        <SafeLoanView
          result={loan.data}
          incomePending={loan.isFetching}
          onIncome={(amount) => setIncome(amount)}
          controls={
            <div className={classes.loanControls}>
              <Switch
                label={t("loan.domestic")}
                checked={domestic}
                onChange={(event) => setDomestic(event.currentTarget.checked)}
              />
              <div className={classes.loanFields}>
                <TextInput
                  label={t("loan.rate")}
                  placeholder={t("loan.ratePlaceholder")}
                  inputMode="decimal"
                  value={rateText}
                  error={
                    rateText.trim() !== "" && rate === undefined ? t("loan.rateInvalid") : null
                  }
                  onChange={(event) => setRateText(event.currentTarget.value)}
                />
                <TextInput
                  label={t("loan.term")}
                  inputMode="numeric"
                  value={termText}
                  error={
                    termText.trim() !== "" && months === undefined ? t("loan.termInvalid") : null
                  }
                  onChange={(event) => setTermText(event.currentTarget.value)}
                />
              </div>
              <p className={classes.muted}>{t("loan.rateHint")}</p>
            </div>
          }
        />
      )}
    </>
  );
}
