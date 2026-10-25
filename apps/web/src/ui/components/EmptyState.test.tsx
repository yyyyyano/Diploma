import { screen } from "@testing-library/react";
import { CircleAlert, Receipt } from "lucide-react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { EmptyState } from "./EmptyState.tsx";

describe("DES-16: EmptyState", () => {
  it("пусто: заголовок, что здесь будет, первые шаги кнопками", () => {
    renderWithProviders(
      <EmptyState
        icon={Receipt}
        title="Чеков пока нет"
        description="Сфотографируйте чек — Кошт разберёт позиции."
        actions={<button type="button">Сканировать чек</button>}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Чеков пока нет" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сканировать чек" })).toBeInTheDocument();
  });

  it("ошибка страницы: заголовок первого уровня и тон риска", () => {
    const { container } = renderWithProviders(
      <EmptyState
        icon={CircleAlert}
        title="Не загрузилось"
        description="Данные целы — попробуйте ещё раз."
        headingLevel={1}
        tone="error"
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Не загрузилось");
    expect(container.querySelector(":scope > div")?.className).toMatch(/error/);
  });
});
