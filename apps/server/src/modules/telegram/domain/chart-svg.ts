// Картинка графика для бота (TG-08, AGT-02): свой SVG без текста — подписи, значения и названия рядов идут в тексте сообщения
// (в `node:*-slim` может не быть кириллических шрифтов, а смысл не должен держаться на картинке и цвете, NFR-20). SVG в PNG
// переводит infrastructure (sharp). Цвета рядов — как у мини-графика сайта (`SERIES_COLORS`, DES-14); числа — как в данных.
import type { ChartData } from "@kosht/contract";
import { formatMoney } from "@kosht/i18n";
import { Money } from "@kosht/kernel";

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 360;
const PADDING = 32;
const BACKGROUND = "#FFFFFF";
const AXIS = "#C9D1CF";
/** Постоянные цвета рядов сайта (apps/web/src/ui/theme/chart-colors.ts), контраст к белому не ниже 3:1. */
const SERIES_COLORS = ["#1F6F63", "#4A6FA5", "#B5655A", "#7A5C8E", "#8C6D3F", "#5B8C85"] as const;

const colorOf = (index: number): string => SERIES_COLORS[index % SERIES_COLORS.length] ?? "#1F6F63";
const fixed = (value: number): string => String(Math.round(value * 10) / 10);

function maxOf(chart: ChartData): number {
  return Math.max(0, ...chart.series.flatMap((series) => series.values));
}

function bars(chart: ChartData): string {
  const innerWidth = CHART_WIDTH - PADDING * 2;
  const innerHeight = CHART_HEIGHT - PADDING * 2;
  const top = maxOf(chart) || 1;
  const groups = Math.max(...chart.series.map((series) => series.values.length));
  const slot = innerWidth / groups;
  const barWidth = (slot * 0.7) / chart.series.length;
  const rects: string[] = [];
  chart.series.forEach((series, seriesIndex) => {
    series.values.forEach((value, at) => {
      const height = Math.max(value > 0 ? 3 : 0, (Math.max(0, value) / top) * innerHeight);
      const x = PADDING + slot * at + slot * 0.15 + barWidth * seriesIndex;
      const y = PADDING + innerHeight - height;
      rects.push(
        `<rect x="${fixed(x)}" y="${fixed(y)}" width="${fixed(barWidth)}" height="${fixed(height)}" rx="3" fill="${colorOf(seriesIndex)}"/>`,
      );
    });
  });
  return rects.join("");
}

function lines(chart: ChartData): string {
  const innerWidth = CHART_WIDTH - PADDING * 2;
  const innerHeight = CHART_HEIGHT - PADDING * 2;
  const top = maxOf(chart) || 1;
  return chart.series
    .map((series, seriesIndex) => {
      const step = series.values.length > 1 ? innerWidth / (series.values.length - 1) : 0;
      const points = series.values
        .map((value, at) => {
          const x = series.values.length > 1 ? PADDING + step * at : PADDING + innerWidth / 2;
          const y = PADDING + innerHeight - (Math.max(0, value) / top) * innerHeight;
          return `${fixed(x)},${fixed(y)}`;
        })
        .join(" ");
      return `<polyline points="${points}" fill="none" stroke="${colorOf(seriesIndex)}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
    })
    .join("");
}

/** Кольцо долей первого ряда: сектора по часовой стрелке от верха; доли считаются из тех же значений, что в подписи. */
function pie(chart: ChartData): string {
  const values = (chart.series[0]?.values ?? []).map((value) => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0);
  const cx = CHART_WIDTH / 2;
  const cy = CHART_HEIGHT / 2;
  const radius = CHART_HEIGHT / 2 - PADDING;
  if (total === 0)
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${AXIS}" stroke-width="2"/>`;
  let angle = -Math.PI / 2;
  return values
    .map((value, index) => {
      const sweep = (value / total) * Math.PI * 2;
      if (value === 0) return "";
      if (value === total)
        return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${colorOf(index)}"/>`;
      const x1 = cx + radius * Math.cos(angle);
      const y1 = cy + radius * Math.sin(angle);
      angle += sweep;
      const x2 = cx + radius * Math.cos(angle);
      const y2 = cy + radius * Math.sin(angle);
      const large = sweep > Math.PI ? 1 : 0;
      return `<path d="M${fixed(cx)},${fixed(cy)} L${fixed(x1)},${fixed(y1)} A${fixed(radius)},${fixed(radius)} 0 ${large} 1 ${fixed(x2)},${fixed(y2)} Z" fill="${colorOf(index)}" stroke="${BACKGROUND}" stroke-width="2"/>`;
    })
    .join("");
}

/** SVG графика 640 × 360: белый фон, ось, ряды; без текста. */
export function chartSvg(chart: ChartData): string {
  const axis =
    chart.kind === "pie"
      ? ""
      : `<line x1="${PADDING}" y1="${CHART_HEIGHT - PADDING}" x2="${CHART_WIDTH - PADDING}" y2="${CHART_HEIGHT - PADDING}" stroke="${AXIS}" stroke-width="2"/>`;
  const body =
    chart.kind === "bar" ? bars(chart) : chart.kind === "line" ? lines(chart) : pie(chart);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}"><rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="${BACKGROUND}"/>${axis}${body}</svg>`;
}

/** Предел подписи к фото в Telegram. */
const CAPTION_LIMIT = 1024;

function valueText(chart: ChartData, value: number): string {
  if (chart.unit === "money" && chart.currency !== null)
    return formatMoney(Money.of(Math.round(value), chart.currency));
  if (chart.unit === "percent") return `${String(Math.round(value))}%`;
  return String(value);
}

/** Подпись к картинке: название и значения по подписям — вся информация графика текстом (цвет и форма её не несут). */
export function chartCaption(chart: ChartData): string {
  const rows: string[] = [chart.title];
  for (const series of chart.series) {
    if (chart.series.length > 1) rows.push(series.name);
    series.values.forEach((value, at) => {
      rows.push(`${chart.labels[at] ?? String(at + 1)} — ${valueText(chart, value)}`);
    });
  }
  const text = rows.join("\n");
  return text.length <= CAPTION_LIMIT ? text : `${text.slice(0, CAPTION_LIMIT - 1)}…`;
}
