// AFF-05, AFF-07, CHAT-04, P6: карточки сценариев покупки и безопасного платежа в чате — результат инструментов `afford_scenarios`
// и `safe_loan_payment`. Не по схеме — ничего; в чате формы дохода нет — доход спрашивает агент. Сеть — MSW.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LOAN_NO_LIMIT, LOAN_OK, NEEDS_INCOME, SAFE } from "../../../entities/afford/fixtures.ts";
import { renderWithProviders } from "../../../test/render.tsx";
import { AffordCard, SafeLoanCard } from "./AffordCard.tsx";
import { TOOL_CARDS } from "./registry.tsx";

const render = (ui: Parameters<typeof renderWithProviders>[0]) =>
  renderWithProviders(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("afford_scenarios", () => {
  it("три сценария и график в карточке чата; без формы дохода", () => {
    render(<AffordCard output={NEEDS_INCOME} />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("figure", { name: /График остатка по дням/u })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Пересчитать" })).toBeNull();
  });

  it("результат не по схеме — карточки нет, ответ ассистента остаётся", () => {
    render(<AffordCard output={{ scenarios: [] }} />);
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("реестр: карточка подключена к инструментам по имени", () => {
    expect(Object.keys(TOOL_CARDS)).toEqual(
      expect.arrayContaining(["afford_scenarios", "safe_loan_payment"]),
    );
    const Card = TOOL_CARDS["afford_scenarios"];
    expect(Card).toBeDefined();
    render(Card === undefined ? <></> : <Card output={SAFE} messageId="m" />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });
});

describe("safe_loan_payment", () => {
  it("безопасный платёж и сумма кредита", () => {
    render(<SafeLoanCard output={LOAN_OK} />);
    expect(screen.getAllByText("480,00").length).toBeGreaterThan(0);
    expect(screen.getByText("20 628,96")).toBeVisible();
  });

  it("предел не подтверждён — «нет предела» без чисел", () => {
    render(<SafeLoanCard output={LOAN_NO_LIMIT} />);
    expect(screen.getByText(/ещё не подтверждён/u)).toBeVisible();
  });

  it("не по схеме — ничего", () => {
    render(<SafeLoanCard output={{ status: "ok" }} />);
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
