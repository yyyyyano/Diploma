import type { AccountListItem } from "@kosht/contract";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { AccountCard } from "./AccountCard.tsx";

const cash = {
  id: "0190f0a0-0000-7000-8000-0000000000c1",
  kind: "cash",
  name: null,
  balance: { minor: 0, currency: "BYN" },
} as AccountListItem;

describe("STMT-01: карточка счёта", () => {
  it("«Наличные» без своего имени — подпись по виду, остаток «0,00 BYN»", () => {
    renderWithProviders(<AccountCard account={cash} />);
    const card = screen.getByRole("article", { name: "Наличные" });
    expect(card).toHaveTextContent("Есть у каждого · BYN");
    expect(card).toHaveTextContent(/Остаток\s*0,00\sBYN/);
  });

  it("своё название счёта важнее подписи по виду", () => {
    renderWithProviders(<AccountCard account={{ ...cash, name: "Кошелёк" }} />);
    expect(screen.getByRole("article", { name: "Кошелёк" })).toBeInTheDocument();
  });
});
