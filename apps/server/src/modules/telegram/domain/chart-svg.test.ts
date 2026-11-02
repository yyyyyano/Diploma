// TG-08: SVG графика — без текста (подписи в сообщении), по виду ряда; подпись содержит все значения.
import type { ChartData } from "@kosht/contract";
import { describe, expect, it } from "vitest";
import { chartCaption, chartSvg } from "./chart-svg.ts";

const bar: ChartData = {
  kind: "bar",
  title: "Расходы по категориям",
  unit: "money",
  currency: "BYN",
  labels: ["Продукты", "Кафе"],
  series: [{ name: "Октябрь", values: [41_250, 10_000] }],
};

describe("картинка графика", () => {
  it("столбцы: по одному на значение, без текстовых элементов; высота пропорциональна значению", () => {
    const svg = chartSvg(bar);
    expect(svg).not.toContain("<text");
    const heights = [
      ...svg.matchAll(/<rect x="[^"]+" y="[^"]+" width="[^"]+" height="([\d.]+)" rx/g),
    ].map((m) => Number(m[1]));
    expect(heights).toHaveLength(2);
    expect((heights[1] ?? 0) / (heights[0] ?? 1)).toBeCloseTo(10_000 / 41_250, 1);
  });

  it("линия — ломаная на ряд; кольцо — сектор на значение; пустое кольцо не ломает рисунок", () => {
    const line = chartSvg({
      ...bar,
      kind: "line",
      series: [
        { name: "a", values: [1, 3, 2] },
        { name: "b", values: [2, 2, 2] },
      ],
    });
    expect(line.match(/<polyline/g)).toHaveLength(2);
    const pie = chartSvg({ ...bar, kind: "pie", series: [{ name: "a", values: [30, 70] }] });
    expect(pie.match(/<path/g)).toHaveLength(2);
    expect(chartSvg({ ...bar, kind: "pie", series: [{ name: "a", values: [0, 0] }] })).toContain(
      "<circle",
    );
  });

  it("подпись — название и все значения словами: деньги — через formatMoney, проценты со знаком %", () => {
    expect(chartCaption(bar).replaceAll(" ", " ")).toBe(
      "Расходы по категориям\nПродукты — 412,50 BYN\nКафе — 100,00 BYN",
    );
    expect(
      chartCaption({
        ...bar,
        unit: "percent",
        currency: null,
        series: [{ name: "a", values: [84, 40] }],
      }),
    ).toContain("Продукты — 84%");
  });

  it("подпись не длиннее предела Telegram", () => {
    const many: ChartData = {
      ...bar,
      labels: Array.from({ length: 60 }, (_, at) => `Категория номер ${String(at)}`),
      series: [{ name: "a", values: Array.from({ length: 60 }, () => 123_456) }],
    };
    expect(chartCaption(many).length).toBeLessThanOrEqual(1024);
  });
});
