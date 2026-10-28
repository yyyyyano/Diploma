// DES-14: значок категории — цвет из таблицы категорий, декоративный без подписи и с именем — с подписью.
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { CATEGORY_COLORS } from "../theme/category-colors.ts";
import { CategoryIcon } from "./CategoryIcon.tsx";

describe("DES-14: CategoryIcon", () => {
  it("с подписью — изображение с именем и постоянным цветом категории", () => {
    renderWithProviders(<CategoryIcon icon="shopping-cart" color="groceries" label="Продукты" />);
    const icon = screen.getByRole("img", { name: "Продукты" });
    expect(icon).toHaveStyle({ backgroundColor: CATEGORY_COLORS.groceries });
    expect(icon).toHaveAttribute("data-color", "groceries");
  });

  it("без подписи — декоративный: скрыт от экранного диктора", () => {
    const { container } = renderWithProviders(
      <CategoryIcon icon="car-taxi-front" color="taxi" size="sm" />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const icon = container.querySelector("[data-color='taxi']");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon?.className).toContain("sm");
  });
});
