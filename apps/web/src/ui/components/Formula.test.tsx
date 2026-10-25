import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { Formula } from "./Formula.tsx";

describe("P2: Formula", () => {
  it("строки «название — значение» и итог — список определений по порядку", () => {
    renderWithProviders(
      <Formula
        rows={[
          { id: "fin.averageIncome", label: "Средний доход", value: "2 400,00" },
          { id: "fin.obligations", label: "Обязательные платежи", value: "677,77" },
        ]}
        total={{ id: "fin.freeBalance", label: "Свободный остаток", value: "1 722,23" }}
      />,
    );
    const terms = screen.getAllByRole("term").map((term) => term.textContent);
    expect(terms).toEqual(["Средний доход", "Обязательные платежи", "Свободный остаток"]);
    const total = screen.getByText("Свободный остаток").parentElement;
    expect(within(total as HTMLElement).getByRole("definition")).toHaveTextContent("1 722,23");
  });
});
