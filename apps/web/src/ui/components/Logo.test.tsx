import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { Logo } from "./Logo.tsx";

describe("Logo — знак и название", () => {
  it("название читается словом, буква знака скрыта от экранного диктора", () => {
    const { container } = renderWithProviders(<Logo />);
    expect(screen.getByText("Кошт")).toBeInTheDocument();
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent("К");
  });

  it("на тёмной панели — светлый вариант", () => {
    renderWithProviders(<Logo on="dark" />);
    expect(screen.getByText("Кошт").parentElement).toHaveClass("dark");
  });
});
