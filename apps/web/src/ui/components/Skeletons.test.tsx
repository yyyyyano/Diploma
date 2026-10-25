import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { SkeletonCard, SkeletonList, SkeletonText } from "./Skeletons.tsx";

describe("DES-16: скелетоны загрузки", () => {
  it("карточка — живая область «Загрузка…» с aria-busy, полосы скрыты от диктора", () => {
    const { container } = renderWithProviders(<SkeletonCard />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Загрузка…");
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });

  it("список — столько строк, сколько попросили", () => {
    const { container } = renderWithProviders(<SkeletonList rows={4} />);
    // В строке: значок, две строки текста, сумма.
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(16);
  });

  it("абзац — последняя строка короче", () => {
    const { container } = renderWithProviders(<SkeletonText lines={3} />);
    const bars = [...container.querySelectorAll<HTMLElement>('[aria-hidden="true"]')];
    expect(bars.map((bar) => bar.style.width)).toEqual(["100%", "100%", "60%"]);
  });
});
