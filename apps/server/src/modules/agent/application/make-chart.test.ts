// AGT-03, AGT-04: make_chart — не больше шести рядов; значения рядов обязаны быть в результатах инструментов.
import { MAX_CHART_SERIES, type ChartData } from "@kosht/contract";
import { describe, expect, it } from "vitest";
import { NumberLedger } from "../../llm/index.ts";
import { checkChart, makeChartTool, type MakeChartResult } from "./make-chart.ts";

const ledger = new NumberLedger();
ledger.addJson({ taxi: 12_000, cafe: 8_050 });

const chart: ChartData = {
  kind: "bar",
  title: "Траты",
  unit: "money",
  currency: "BYN",
  labels: ["Такси", "Кафе"],
  series: [{ name: "Сентябрь", values: [12_000, 8_050] }],
};

describe("make_chart", () => {
  it("значения из результатов инструментов — график принят", () => {
    expect(checkChart(chart, ledger)).toEqual({ ok: true });
  });

  it("выдуманное значение — VALIDATION, график не строится", () => {
    const invented = { ...chart, series: [{ name: "Сентябрь", values: [12_000, 9_999] }] };
    expect(checkChart(invented, ledger)).toEqual({ ok: false, code: "VALIDATION" });
  });

  it("длина ряда не совпадает с числом меток — VALIDATION", () => {
    const short = { ...chart, series: [{ name: "Сентябрь", values: [12_000] }] };
    expect(checkChart(short, ledger)).toEqual({ ok: false, code: "VALIDATION" });
  });

  it("инструмент сообщает итог проверки потоку ответа", async () => {
    const seen: MakeChartResult[] = [];
    const tool = makeChartTool(ledger, (result) => seen.push(result));
    expect(await tool.execute?.(chart, { toolCallId: "c", messages: [], context: {} })).toEqual({
      ok: true,
    });
    expect(seen).toEqual([{ ok: true }]);
  });

  it("лимит рядов в схеме — шесть", () => {
    expect(MAX_CHART_SERIES).toBe(6);
  });
});
