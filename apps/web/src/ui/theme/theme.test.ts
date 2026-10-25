// Тема — копия макета (DES-01, frontend-ui.md): токены design/tokens.css один в один, плюс токены SPEC §7.1;
// значения набора kit.css не добавляют новых цветов; цвета категорий — таблица design/DESIGN.md.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATEGORY_COLORS } from "./category-colors.ts";
import { CHART_COLORS } from "./chart-colors.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const DESIGN = "../../../../../design/";

/**
 * Значение CSS в одном виде: oxfmt (make fmt) пишет hex строчными, кавычки двойными, «0.08» вместо «.08» и пробелы
 * после запятых — сравниваются значения, а не написание.
 */
function normalize(value: string): string {
  return value.toLowerCase().replaceAll("'", '"').replaceAll(/\s+/g, "").replaceAll(/\b0\./g, ".");
}

/** Пары «--имя: значение» из CSS без комментариев; значение — в одном виде (normalize). */
function declarations(css: string): Map<string, string> {
  const text = css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  return new Map(
    [...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
      m[1] ?? "",
      normalize(m[2] ?? ""),
    ]),
  );
}

const HEX_OR_RGB = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const colorsOf = (text: string) => [...text.matchAll(HEX_OR_RGB)].map((m) => normalize(m[0]));

describe("DES-01: токены темы", () => {
  it("каждый токен design/tokens.css есть в ui/theme/tokens.css с тем же значением", () => {
    const design = declarations(read(`${DESIGN}tokens.css`));
    const ours = declarations(read("./tokens.css"));
    expect(design.size).toBeGreaterThan(25);
    const copied = Object.fromEntries([...design.keys()].map((name) => [name, ours.get(name)]));
    expect(copied).toEqual(Object.fromEntries(design));
  });

  it("сверх макета — только токены SPEC §7.1: --warn-bar #C2700E", () => {
    const design = declarations(read(`${DESIGN}tokens.css`));
    const extra = [...declarations(read("./tokens.css"))].filter(([name]) => !design.has(name));
    expect(extra).toEqual([["--warn-bar", normalize("#C2700E")]]);
  });

  it("kit.css темы не вводит новых цветов: каждый — из design/kit.css или каркаса телефона макета", () => {
    // Каркас телефона (ph-) одинаков во всех телефонных экранах макета; берём его из MobileHome.
    const phone =
      /PHONE SHELL[\s\S]*?PAGE:/.exec(read(`${DESIGN}screens/MobileHome.dc.html`))?.[0] ?? "";
    expect(phone).not.toBe("");
    const kit = new Set([...colorsOf(read(`${DESIGN}kit.css`)), ...colorsOf(phone)]);
    expect(colorsOf(read("./kit.css")).filter((color) => !kit.has(color))).toEqual([]);
  });
});

describe("DES-14: цвета категорий и графиков", () => {
  it("таблица категорий совпадает с design/DESIGN.md: 17 постоянных цветов", () => {
    const paragraph = /\*\*Цвета категорий\*\*([\s\S]*?)На диаграмме/.exec(
      read(`${DESIGN}DESIGN.md`),
    );
    const design = colorsOf(paragraph?.[1] ?? "");
    expect(design).toHaveLength(17);
    expect(Object.values(CATEGORY_COLORS).map(normalize)).toEqual(design);
  });

  it("доходы #2F8A5B, расходы #2B4743", () => {
    expect(CHART_COLORS).toEqual({ income: "#2F8A5B", expense: "#2B4743" });
  });
});
