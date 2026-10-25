import { Money as M } from "@kosht/kernel";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { Money } from "./Money.tsx";
import { StatCard } from "./StatCard.tsx";
import { WhyButton } from "./WhyButton.tsx";

describe("DES-13: StatCard", () => {
  it("подпись, крупная сумма, пояснение и кнопка «Откуда эта цифра?»", () => {
    renderWithProviders(
      <StatCard
        title="На счетах"
        value={<Money value={M.of(498_964, "BYN")} size="kpi" />}
        hint="5 счетов"
        why={<WhyButton subject="На счетах" onClick={() => {}} />}
      />,
    );
    expect(screen.getByText("На счетах")).toBeInTheDocument();
    expect(screen.getByText("5 счетов")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Откуда эта цифра: На счетах" })).toBeInTheDocument();
  });

  it("свободный остаток — карточка brand-soft (tone free)", () => {
    const { container } = renderWithProviders(
      <StatCard title="Свободный остаток" value="—" tone="free" />,
    );
    expect(container.querySelector(":scope > div")?.className).toMatch(/free/);
  });

  it("без пояснения лишнего блока нет", () => {
    const { container } = renderWithProviders(<StatCard title="Расходы" value="—" />);
    expect(container.querySelector(":scope > div")?.children).toHaveLength(2);
  });
});
