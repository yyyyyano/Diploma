// DASH-02, DASH-03, DES-14: динамика по месяцам — пары столбцов, пропорции, подписи для диктора и переход по нажатию.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { ColumnChart } from "./ColumnChart.tsx";

const columns = [
  {
    id: "2026-09",
    label: "сен",
    income: 240_000,
    expense: 120_000,
    incomeText: "Доходы, сентябрь: 2 400,00 BYN",
    expenseText: "Расходы, сентябрь: 1 200,00 BYN",
  },
  {
    id: "2026-10",
    label: "окт",
    income: 0,
    expense: 60_000,
    incomeText: "Доходы, октябрь: 0,00 BYN",
    expenseText: "Расходы, октябрь: 600,00 BYN",
  },
];

/** Видимый столбец — вложенный элемент кнопки: область нажатия не зависит от высоты значения (WCAG 2.5.8). */
const fillOf = (name: string) =>
  screen.getByRole("button", { name }).firstElementChild as HTMLElement;

describe("DASH-02: столбцы месяцев", () => {
  it("у каждого столбца своя подпись для диктора; высота — доля от наибольшего", () => {
    renderWithProviders(<ColumnChart columns={columns} label="Динамика по месяцам" />);
    expect(screen.getByRole("figure", { name: "Динамика по месяцам" })).toBeInTheDocument();
    expect(fillOf("Доходы, сентябрь: 2 400,00 BYN")).toHaveStyle({ height: "100%" });
    expect(fillOf("Расходы, сентябрь: 1 200,00 BYN")).toHaveStyle({ height: "50%" });
    expect(fillOf("Расходы, октябрь: 600,00 BYN")).toHaveStyle({ height: "25%" });
  });

  it("нулевой столбец не рисуется, непустой тонкий — виден (не меньше 3 %)", () => {
    renderWithProviders(
      <ColumnChart
        columns={[
          {
            ...columns[0]!,
            income: 1_000_000,
            expense: 100,
            expenseText: "Расходы: 1,00 BYN",
            incomeText: "Доходы: 10 000,00 BYN",
          },
          columns[1]!,
        ]}
        label="Динамика"
      />,
    );
    expect(fillOf("Расходы: 1,00 BYN")).toHaveStyle({ height: "3%" });
    expect(fillOf("Доходы, октябрь: 0,00 BYN")).toHaveStyle({ height: "0%" });
  });

  it("нажатие на столбец отдаёт месяц и вид — страница ведёт в операции (DASH-03)", async () => {
    const onSelect = vi.fn<(id: string, kind: "income" | "expense") => void>();
    renderWithProviders(<ColumnChart columns={columns} label="Динамика" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Расходы, октябрь: 600,00 BYN" }));
    await userEvent.click(screen.getByRole("button", { name: "Доходы, сентябрь: 2 400,00 BYN" }));
    expect(onSelect.mock.calls).toEqual([
      ["2026-10", "expense"],
      ["2026-09", "income"],
    ]);
  });

  it("пустой набор месяцев не падает", () => {
    renderWithProviders(<ColumnChart columns={[]} label="Динамика" />);
    expect(screen.getByRole("figure", { name: "Динамика" })).toBeInTheDocument();
  });
});
