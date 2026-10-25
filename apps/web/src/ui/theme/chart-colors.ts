// Цвета графиков (DES-14): доходы и расходы; категории — CATEGORY_COLORS. На диаграмме не больше 6 рядов, остальное
// сворачивается в «Остальное» (цвет CATEGORY_COLORS.other).
export const CHART_COLORS = {
  income: "#2F8A5B",
  expense: "#2B4743",
} as const;

/** Сколько рядов показывает диаграмма до свёртки в «Остальное» (DES-14). */
export const MAX_CHART_SERIES = 6;
