// График (AGT-02, AGT-03, CHAT-04): инструмент `make_chart` — карточка по данным из результатов других инструментов.
// Не больше шести рядов; каждое значение ряда проходит ту же проверку, что числа текста ответа (AGT-04, P1): значение
// обязано быть в результатах инструментов (копейки или рубли), иначе график не строится. Сам график рисует сайт по
// части `data-chart`, которую по этому вызову пишет поток ответа.
import { ChartData } from "@kosht/contract";
import { tool } from "ai";
import { toolInputSchema } from "./tool-schema.ts";
import type { NumberLedger } from "../domain/numbers.ts";

export const MAKE_CHART = "make_chart";

export const MAKE_CHART_DESCRIPTION =
  "Draw a chart (max 6 series) from numbers already in tool results, exactly as there (kopecks). Never invent values.";

/** Результат для модели: график показан или вызов не по правилам. */
export type MakeChartResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "VALIDATION" };

/** Проверка вызова: длины рядов и меток совпадают, значения — из результатов инструментов. */
export function checkChart(chart: ChartData, ledger: NumberLedger): MakeChartResult {
  for (const series of chart.series) {
    if (series.values.length !== chart.labels.length) return { ok: false, code: "VALIDATION" };
    if (!series.values.every((value) => ledger.hasValue(value))) {
      return { ok: false, code: "VALIDATION" };
    }
  }
  return { ok: true };
}

export function makeChartTool(ledger: NumberLedger, onChecked: (result: MakeChartResult) => void) {
  return tool({
    description: MAKE_CHART_DESCRIPTION,
    inputSchema: toolInputSchema(ChartData),
    execute: (input: unknown): MakeChartResult => {
      const chart = ChartData.safeParse(input);
      const result: MakeChartResult = chart.success
        ? checkChart(chart.data, ledger)
        : { ok: false, code: "VALIDATION" };
      onChecked(result);
      return result;
    },
  });
}
