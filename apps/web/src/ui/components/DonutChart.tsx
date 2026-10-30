// Кольцевая диаграмма трат (DASH-02, DES-14, design/screens/Main.dc.html .donut): сегменты по значениям, число в центре.
// Своя, а не Mantine Charts: вид макета (SVG-кольцо с обводкой и подписью в центре) — десяток строк, а Recharts в
// чанке главной — ≈ 120 КБ gzip (ADR-0013, замер T-033). Диаграмма — картинка (`aria-hidden`): тот же состав читается из
// скрытой таблицы, а нажимается легенда рядом (страница). Значения — только для долей кольца: суммы и подписи приходят
// готовыми с сервера (P1).
import { useTranslation } from "react-i18next";
import classes from "./DonutChart.module.css";

export interface DonutSegment {
  readonly id: string;
  readonly label: string;
  /** Размер сегмента — копейки; доля кольца = значение ÷ сумма значений (геометрия, не деньги). */
  readonly value: number;
  /** Цвет сегмента — токен темы. */
  readonly color: string;
  /** Подпись суммы для таблицы диктора: «1 200,00 BYN». */
  readonly valueText: string;
}

export interface DonutChartProps {
  readonly segments: readonly DonutSegment[];
  /** Подпись в центре («Октябрь») и значение («1 842,60»); валюта — мелко под ним. */
  readonly centerLabel: string;
  readonly centerValue: string;
  readonly centerUnit: string;
  /** Название диаграммы для диктора («Траты по категориям»). */
  readonly label: string;
}

const RADIUS = 70;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function DonutChart({
  segments,
  centerLabel,
  centerValue,
  centerUnit,
  label,
}: DonutChartProps) {
  const { t } = useTranslation("ui");
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  return (
    <figure className={classes.donut}>
      <svg viewBox="0 0 180 180" className={classes.ring} aria-hidden>
        <circle cx={90} cy={90} r={RADIUS} fill="none" className={classes.track} strokeWidth={26} />
        {total > 0 &&
          segments.map((segment) => {
            const length = (segment.value / total) * CIRCUMFERENCE;
            const circle = (
              <circle
                key={segment.id}
                cx={90}
                cy={90}
                r={RADIUS}
                fill="none"
                stroke={segment.color}
                strokeWidth={26}
                strokeDasharray={`${String(length)} ${String(CIRCUMFERENCE - length)}`}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return circle;
          })}
      </svg>
      <figcaption className={classes.center}>
        <span className={classes.centerLabel}>{centerLabel}</span>
        <span className={classes.centerValue}>{centerValue}</span>
        <span className={classes.centerLabel}>{centerUnit}</span>
      </figcaption>
      <div className={classes.srOnly}>
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">{t("chart.category")}</th>
              <th scope="col">{t("chart.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((segment) => (
              <tr key={segment.id}>
                <th scope="row">{segment.label}</th>
                <td>{segment.valueText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
