// BUD-02, DES-14: полоса лимита на границах 79 / 80 / 99 / 100 % — цвет, значок и подпись для диктора.
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { LimitBar, limitLevel } from "./LimitBar.tsx";

function bar(percent: number) {
  const { container } = renderWithProviders(
    <LimitBar
      percent={percent}
      label="Кафе"
      status={`${String(percent)}% · осталось 32,00`}
      marker="80%"
    />,
  );
  const progress = screen.getByRole("progressbar", { name: "Кафе" });
  return { container, progress, fill: progress };
}

describe("BUD-02: уровни полосы", () => {
  it("уровень по проценту: 79 — обычный, 80 и 99 — внимание, 100 и больше — превышение", () => {
    expect([79, 80, 99, 100, 112].map(limitLevel)).toEqual(["ok", "warn", "warn", "over", "over"]);
  });

  it("79 % — цвет бренда, без значка", () => {
    const { fill, container } = bar(79);
    expect(fill?.className).toContain("ok");
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("progressbar")).toHaveValue(79);
  });

  it("80 % — янтарная полоса и треугольник (не только цвет)", () => {
    const { fill, container } = bar(80);
    expect(fill?.className).toContain("warn");
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("[data-level='warn']")).not.toBeNull();
  });

  it("99 % — всё ещё внимание, а не превышение", () => {
    const { fill } = bar(99);
    expect(fill?.className).toContain("warn");
    expect(fill?.className).not.toContain("over");
  });

  it("100 % — красная полоса и значок «!»; 112 % заливка не шире трека, а диктор слышит полный текст", () => {
    const { fill, progress } = bar(112);
    expect(fill?.className).toContain("over");
    expect(progress).toHaveValue(100);
    expect(progress).toHaveAttribute("max", "100");
    expect(progress).toHaveAttribute("aria-valuetext", "112% · осталось 32,00");
  });

  it("отметка порога 80 % есть только когда её просят", () => {
    renderWithProviders(<LimitBar percent={10} label="Такси" status="10%" />);
    expect(screen.queryByText("80%")).toBeNull();
  });
});
