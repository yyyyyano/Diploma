// TG-08: картинка графика — настоящий PNG нужного размера (sharp рисует SVG без шрифтов: текста в нём нет).
import type { ChartData } from "@kosht/contract";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { CHART_HEIGHT, CHART_WIDTH } from "../../domain/chart-svg.ts";
import { renderChartPng } from "./chart-png.ts";

const base: ChartData = {
  kind: "bar",
  title: "Лимиты",
  unit: "percent",
  currency: null,
  labels: ["Кафе", "Продукты", "Такси"],
  series: [{ name: "Использовано", values: [84, 40, 110] }],
};

describe("график → PNG", () => {
  it.each(["bar", "line", "pie"] as const)("%s: PNG-сигнатура и размер %i × %i", async (kind) => {
    const png = await renderChartPng({ ...base, kind });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([CHART_WIDTH, CHART_HEIGHT]);
  });

  it("столбцы не пустой белый лист: в картинке есть цвета ряда", async () => {
    const { data } = await sharp(await renderChartPng(base))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(
      new Set(Array.from({ length: data.length / 3 }, (_, at) => data.readUIntBE(at * 3, 3))).size,
    ).toBeGreaterThan(2);
  });
});
