// XLS-01: «Выгрузить в Excel» — ссылка на файл за выбранный период; нет данных — кнопка выключена, ссылки нет.
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { ExportExcelButton } from "./ExportExcelButton.tsx";

describe("XLS-01: кнопка «Выгрузить в Excel»", () => {
  it("ведёт на выгрузку за период из адреса страницы и скачивает файл", () => {
    renderWithProviders(<ExportExcelButton from="2026-09-01" to="2026-09-30" />);
    const link = screen.getByRole("link", { name: "Выгрузить в Excel" });
    expect(link).toHaveAttribute("href", "/api/xls-export?from=2026-09-01&to=2026-09-30");
    expect(link).toHaveAttribute("download");
  });

  it("период не задан — ссылка без параметров (сервер возьмёт текущий месяц)", () => {
    renderWithProviders(<ExportExcelButton />);
    expect(screen.getByRole("link", { name: "Выгрузить в Excel" })).toHaveAttribute(
      "href",
      "/api/xls-export",
    );
  });

  it("нет данных — кнопка выключена и не ссылка", () => {
    renderWithProviders(<ExportExcelButton from="2026-09-01" to="2026-09-30" disabled />);
    expect(screen.getByRole("button", { name: "Выгрузить в Excel" })).toBeDisabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
