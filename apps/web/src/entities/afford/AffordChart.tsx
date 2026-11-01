// График остатка по дням (AFF-07, DES-14): линии «без покупки», «сейчас» и «после дохода», нулевой уровень и месячные обязательные
// платежи. Значения — целые копейки с сервера (`chart`), здесь только геометрия: масштаб по высоте и подпись для диктора (деньги не
// считаются, P1). Рисунок — SVG с токенами темы; смысл дублируют легенда и подписи минимумов рядом с ним.
import type { AffordResult } from "@kosht/contract";
import { formatDate, formatMoney } from "@kosht/i18n";
import { LocalDate, Money } from "@kosht/kernel";
import { useTranslation } from "react-i18next";
import classes from "./afford.module.css";

const WIDTH = 800;
const HEIGHT = 260;
const PAD = { top: 12, right: 8, bottom: 12, left: 8 } as const;

export interface AffordChartProps {
  readonly result: AffordResult;
}

/** Номер дня от начала графика: позиция точки минимума на оси. */
function indexOf(from: string, on: string): number {
  return LocalDate.daysBetween(LocalDate.parse(from), LocalDate.parse(on));
}

export function AffordChart({ result }: AffordChartProps) {
  const { t } = useTranslation("afford");
  const { chart } = result;
  const series = [
    { id: "baseline", values: chart.baseline },
    { id: "now", values: chart.now },
    ...(chart.afterIncome === null ? [] : [{ id: "after", values: chart.afterIncome }]),
  ];
  const obligations = chart.obligationsMonthly?.minor ?? null;
  const all = [
    ...series.flatMap((line) => line.values),
    0,
    ...(obligations === null ? [] : [obligations]),
  ];
  const low = Math.min(...all);
  const high = Math.max(...all);
  const span = Math.max(1, high - low);
  const count = Math.max(2, chart.baseline.length);
  const x = (index: number) => PAD.left + (index / (count - 1)) * (WIDTH - PAD.left - PAD.right);
  const y = (value: number) =>
    PAD.top + (1 - (value - low) / span) * (HEIGHT - PAD.top - PAD.bottom);
  const path = (values: readonly number[]) =>
    values
      .map(
        (value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`,
      )
      .join(" ");

  const marks = result.scenarios.flatMap((scenario, order) =>
    scenario.lowest === null || scenario.kind === "save"
      ? []
      : [
          {
            id: scenario.kind,
            n: order + 1,
            index: indexOf(chart.from, scenario.lowest.on),
            value: scenario.lowest.amount.amount,
            on: scenario.lowest.on,
          },
        ],
  );
  const minimum = (mark: (typeof marks)[number]) =>
    t("chart.minimum", { n: mark.n, amount: formatMoney(mark.value), date: formatDate(mark.on) });
  const summary = marks.map(minimum).join("; ");
  const after = result.scenarios.find((s) => s.kind === "after-income");

  return (
    <div className={classes.chartBlock}>
      <ul className={classes.legend}>
        <li className={classes.legendNow}>{t("chart.now")}</li>
        {chart.afterIncome !== null && after?.on != null && (
          <li className={classes.legendAfter}>
            {t("chart.after", { date: formatDate(after.on) })}
          </li>
        )}
        <li className={classes.legendBase}>{t("chart.baseline")}</li>
      </ul>
      <figure className={classes.figure} aria-label={t("chart.label", { summary })}>
        <svg
          className={classes.chart}
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          aria-hidden
        >
          <line className={classes.zero} x1={PAD.left} x2={WIDTH - PAD.right} y1={y(0)} y2={y(0)} />
          {obligations !== null && (
            <line
              className={classes.obligations}
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(obligations)}
              y2={y(obligations)}
            />
          )}
          <path className={classes.lineBase} d={path(chart.baseline)} />
          {chart.afterIncome !== null && (
            <path className={classes.lineAfter} d={path(chart.afterIncome)} />
          )}
          <path className={classes.lineNow} d={path(chart.now)} />
          {marks.map((mark) => (
            <circle
              key={mark.id}
              className={mark.id === "now" ? classes.dotNow : classes.dotAfter}
              cx={x(mark.index)}
              cy={y(mark.value.minor)}
              r={5}
            />
          ))}
        </svg>
      </figure>
      <ul className={classes.minimums}>
        {marks.map((mark) => (
          <li key={mark.id}>{minimum(mark)}</li>
        ))}
        <li className={classes.legendZero}>{t("chart.zero")}</li>
        {obligations !== null && (
          <li className={classes.legendObligations}>
            {t("chart.obligations", { amount: formatMoney(Money.of(obligations, "BYN")) })}
          </li>
        )}
      </ul>
      <p className={classes.note}>{t("chart.note")}</p>
    </div>
  );
}
