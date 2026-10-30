// DASH-02, DES-14: кольцо трат — сегменты по долям, число в центре и таблица для диктора.
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { DonutChart } from "./DonutChart.tsx";

const segments = [
  { id: "a", label: "Продукты", value: 75_000, color: "var(--brand)", valueText: "750,00 BYN" },
  { id: "b", label: "Такси", value: 25_000, color: "var(--warn-bar)", valueText: "250,00 BYN" },
];

describe("DASH-02: кольцо трат", () => {
  it("центр — подпись и итог; таблица для диктора перечисляет категории с суммами", () => {
    renderWithProviders(
      <DonutChart
        segments={segments}
        centerLabel="Октябрь"
        centerValue="1 000,00"
        centerUnit="BYN"
        label="Траты по категориям"
      />,
    );
    expect(screen.getByText("1 000,00")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Траты по категориям" });
    expect(within(table).getByRole("row", { name: /Продукты.*750,00 BYN/ })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Такси.*250,00 BYN/ })).toBeInTheDocument();
  });

  it("доли кольца пропорциональны значениям: 75 % и 25 % длины окружности", () => {
    const { container } = renderWithProviders(
      <DonutChart
        segments={segments}
        centerLabel="Октябрь"
        centerValue="1 000,00"
        centerUnit="BYN"
        label="Траты"
      />,
    );
    const arcs = [...container.querySelectorAll("circle[stroke-dasharray]")];
    const lengths = arcs.map((arc) =>
      Number((arc.getAttribute("stroke-dasharray") ?? "").split(" ")[0]),
    );
    const whole = 2 * Math.PI * 70;
    expect(lengths[0]! / whole).toBeCloseTo(0.75, 5);
    expect(lengths[1]! / whole).toBeCloseTo(0.25, 5);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("сегментов нет — рисуется только трек, без деления на ноль", () => {
    const { container } = renderWithProviders(
      <DonutChart
        segments={[]}
        centerLabel="Октябрь"
        centerValue="0,00"
        centerUnit="BYN"
        label="Траты"
      />,
    );
    expect(container.querySelectorAll("circle[stroke-dasharray]")).toHaveLength(0);
  });
});
