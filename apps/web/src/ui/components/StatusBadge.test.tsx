import { screen } from "@testing-library/react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { StatusBadge } from "./StatusBadge.tsx";

describe("DES-03, NFR-20: StatusBadge", () => {
  it("текст и иконка: смысл не держится на одном цвете", () => {
    const { container } = renderWithProviders(
      <StatusBadge tone="ok" icon={CircleCheck}>
        Сумма сходится 100%
      </StatusBadge>,
    );
    expect(screen.getByText("Сумма сходится 100%")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("тон задаёт класс роли цвета: внимание — warn", () => {
    const { container } = renderWithProviders(
      <StatusBadge tone="warn" icon={TriangleAlert}>
        Требует проверки
      </StatusBadge>,
    );
    expect(container.querySelector(":scope > span")?.className).toMatch(/warn/);
  });

  it("без иконки не компилируется", () => {
    // @ts-expect-error — icon обязателен: статус без иконки передавал бы смысл одним цветом (NFR-20).
    const badge = <StatusBadge tone="danger">Превышен</StatusBadge>;
    expect(badge.props).not.toHaveProperty("icon");
  });
});
