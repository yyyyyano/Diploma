// Тема дизайн-системы: стили подключаются один раз в app (порядок: Mantine → шрифты → токены → набор → основа).
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "./fonts.ts";
import "./tokens.css";
import "./kit.css";
import "./global.css";

export { CATEGORY_COLORS, type CategoryColorKey } from "./category-colors.ts";
export { CHART_COLORS, MAX_CHART_SERIES, SERIES_COLORS } from "./chart-colors.ts";
export { cssVariablesResolver, theme } from "./theme.ts";
