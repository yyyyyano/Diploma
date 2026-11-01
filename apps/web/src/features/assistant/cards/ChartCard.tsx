// Мини-график ответа (`data-chart`, AGT-02, CHAT-04, DES-14): не больше шести рядов, значения — как в результатах
// инструментов (копейки у денег), проверенные кодом. Сайт ничего не считает (P1): длина полосы — доля от наибольшего
// значения (геометрия), подписи — готовые значения в формате DES-17. Подписанные полосы читаются и без цвета (NFR-20);
// круговой вид рисуется теми же полосами: центр кольца требовал бы итога, а сумму сайт не считает. Для линии добавлена
// таблица значений, она же — для диктора.
import { ChartData, MAX_CHART_SERIES } from "@kosht/contract";
import { formatMoney } from "@kosht/i18n";
import { Money } from "@kosht/kernel";
import { VisuallyHidden } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { SERIES_COLORS } from "../../../ui/index.ts";
import classes from "./ChartCard.module.css";
import { Unavailable } from "./Unavailable.tsx";

type Chart = ChartData;

function useValueText(chart: Chart): (value: number) => string {
  const { t } = useTranslation("assistant");
  return (value) => {
    if (chart.unit === "money" && chart.currency !== null && Number.isSafeInteger(value)) {
      return formatMoney(Money.of(value, chart.currency));
    }
    if (chart.unit === "percent") return t("cards.chart.percent", { value: String(value) });
    return String(value);
  };
}

/** Доля полосы от наибольшего значения, 0…100 (только геометрия, не деньги). */
function widthOf(value: number, max: number): string {
  if (max <= 0 || value <= 0) return "0%";
  return `${String(Math.max(2, Math.round((value / max) * 100)))}%`;
}

export function ChartCard({ data }: { readonly data: unknown }) {
  const parsed = ChartData.safeParse(data);
  if (!parsed.success || parsed.data.series.length > MAX_CHART_SERIES) return <Unavailable />;
  return <Chart chart={parsed.data} />;
}

function Chart({ chart }: { readonly chart: Chart }) {
  const { t } = useTranslation("assistant");
  const text = useValueText(chart);
  const max = Math.max(0, ...chart.series.flatMap((series) => series.values));
  const many = chart.series.length > 1;
  return (
    <figure className={classes.chart} aria-label={t("cards.chart.label", { title: chart.title })}>
      <figcaption className={classes.title}>{chart.title}</figcaption>
      {many && (
        <ul className={classes.legend}>
          {chart.series.map((series, index) => (
            <li key={series.name} className={classes.legendItem}>
              <span
                className={classes.swatch}
                style={{ background: SERIES_COLORS[index] }}
                aria-hidden
              />
              {series.name}
            </li>
          ))}
        </ul>
      )}
      {chart.kind === "line" ? (
        <LineView chart={chart} max={max} />
      ) : (
        <ul className={classes.rows}>
          {chart.labels.map((label, row) => (
            <li key={label} className={classes.row}>
              <span className={classes.label}>{label}</span>
              <span className={classes.bars}>
                {chart.series.map((series, index) => {
                  const value = series.values[row];
                  return value === undefined ? null : (
                    <span key={series.name} className={classes.bar}>
                      <span className={classes.track} aria-hidden>
                        <span
                          className={classes.fill}
                          style={{ width: widthOf(value, max), background: SERIES_COLORS[index] }}
                        />
                      </span>
                      <span className={classes.value}>
                        {many && <VisuallyHidden>{series.name}: </VisuallyHidden>}
                        {text(value)}
                      </span>
                    </span>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

const WIDTH = 300;
const HEIGHT = 90;
const PAD = 6;

/** Динамика линией: точки по числу подписей; значения — таблицей под картинкой (диктор, точные числа). */
function LineView({ chart, max }: { readonly chart: Chart; readonly max: number }) {
  const { t } = useTranslation("assistant");
  const text = useValueText(chart);
  const steps = Math.max(1, chart.labels.length - 1);
  const x = (index: number) => PAD + (index / steps) * (WIDTH - 2 * PAD);
  const y = (value: number) =>
    max <= 0 ? HEIGHT - PAD : HEIGHT - PAD - (Math.max(0, value) / max) * (HEIGHT - 2 * PAD);
  return (
    <>
      <svg className={classes.svg} viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`} aria-hidden>
        {chart.series.map((series, index) => (
          <polyline
            key={series.name}
            fill="none"
            stroke={SERIES_COLORS[index]}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={series.values
              .map((value, i) => `${String(x(i))},${String(y(value))}`)
              .join(" ")}
          />
        ))}
      </svg>
      <table className={classes.table} aria-label={t("cards.chart.table", { title: chart.title })}>
        <thead>
          <tr>
            <th scope="col">
              <VisuallyHidden>{chart.title}</VisuallyHidden>
            </th>
            {chart.series.map((series) => (
              <th key={series.name} scope="col">
                {series.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.labels.map((label, row) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {chart.series.map((series) => (
                <td key={series.name}>
                  {series.values[row] === undefined ? "" : text(series.values[row])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
