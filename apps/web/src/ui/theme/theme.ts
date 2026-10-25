// Тема Mantine «Пуща и янтарь» (DES-01, ADR-0014): цвета и шрифты — переменные tokens.css, Mantine лишь ссылается
// на них. Палитры Mantine требуют десяти оттенков: опорные — точные значения макета (brand-soft, brand-soft-2,
// brand, brand-hover, brand-ink), промежуточные нужны только самой Mantine для её состояний.
import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from "@mantine/core";

const brand: MantineColorsTuple = [
  "#E3EFEA", // --brand-soft
  "#CBE2D9", // --brand-soft-2
  "#A6CDBF",
  "#7FB5A5",
  "#4F9180",
  "#2A7264",
  "#11564D", // --brand
  "#0B4740", // --brand-hover
  "#0D3833", // --brand-ink
  "#082622",
];

export const theme = createTheme({
  fontFamily: "var(--font-ui-local)",
  headings: { fontFamily: "var(--font-ui-local)", fontWeight: "650" },
  primaryColor: "brand",
  primaryShade: 6,
  colors: { brand },
  // Скругления макета: маленькие кнопки 8, кнопки и поля 10, карточки 14, модальное окно 16.
  radius: {
    xs: "var(--r-xs)",
    sm: "var(--r-sm)",
    md: "var(--r)",
    lg: "var(--r-lg)",
    xl: "var(--r-sheet)",
  },
  defaultRadius: "sm",
  spacing: {
    xs: "var(--s-8)",
    sm: "var(--s-12)",
    md: "var(--s-16)",
    lg: "var(--s-20)",
    xl: "var(--s-32)",
  },
  cursorType: "pointer",
  focusRing: "never",
  respectReducedMotion: true,
});

/** Переменные Mantine — на токены макета: её поля, текст и рамки выглядят как набор kit.css. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    "--mantine-font-family": "var(--font-ui-local)",
    "--mantine-font-family-headings": "var(--font-ui-local)",
  },
  light: {
    "--mantine-color-body": "var(--bg)",
    "--mantine-color-text": "var(--ink)",
    "--mantine-color-dimmed": "var(--ink-2)",
    "--mantine-color-placeholder": "var(--ink-3)",
    "--mantine-color-default": "var(--surface)",
    "--mantine-color-default-border": "var(--line-2)",
    "--mantine-color-default-hover": "var(--surface-2)",
    "--mantine-color-default-color": "var(--ink)",
    "--mantine-color-error": "var(--danger)",
    "--mantine-color-anchor": "var(--brand)",
  },
  // Тёмной темы в MVP нет (DES-01): провайдер принудительно светлый, тёмные значения равны светлым.
  dark: {},
});
