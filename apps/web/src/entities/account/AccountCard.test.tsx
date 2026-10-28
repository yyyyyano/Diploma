// STMT-01, STMT-02, STMT-09: карточка счёта — подпись по виду, остаток и день остатка, эквивалент в BYN по курсу НБРБ.
import type { AccountListItem } from "@kosht/contract";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { AccountCard } from "./AccountCard.tsx";

const cash: AccountListItem = {
  id: "0190f0a0-0000-7000-8000-0000000000c1" as AccountListItem["id"],
  kind: "cash",
  name: null,
  bank: null,
  mask: null,
  balance: { minor: 0, currency: "BYN" },
  balanceOn: "2026-10-28" as AccountListItem["balanceOn"],
  balanceSource: "manual",
  initialBalance: { minor: 0, currency: "BYN" },
  balanceInByn: null,
  rate: null,
};

describe("STMT-01, STMT-02: карточка счёта", () => {
  it("«Наличные» без своего имени — подпись по виду, остаток «0,00 BYN» и день остатка", () => {
    renderWithProviders(<AccountCard account={cash} />);
    const card = screen.getByRole("article", { name: "Наличные" });
    expect(card).toHaveTextContent("Есть у каждого · BYN");
    expect(card).toHaveTextContent(/Остаток\s*0,00\sBYN/);
    expect(card).toHaveTextContent("Остаток на 28.10.2026 — указан вами");
  });

  it("своё название счёта важнее подписи по виду; карта без названия — банк и маска", () => {
    renderWithProviders(<AccountCard account={{ ...cash, name: "Кошелёк" }} />);
    expect(screen.getByRole("article", { name: "Кошелёк" })).toBeInTheDocument();
    renderWithProviders(
      <AccountCard
        account={{
          ...cash,
          id: "0190f0a0-0000-7000-8000-0000000000c2" as AccountListItem["id"],
          kind: "card",
          bank: "Беларусбанк",
          mask: "4821",
          balanceSource: "operations",
        }}
      />,
    );
    const card = screen.getByRole("article", { name: "Беларусбанк •• 4821" });
    expect(card).toHaveTextContent("Карта · BYN");
    expect(card).toHaveTextContent("по вашим операциям");
  });

  it("STMT-09: валюта — эквивалент в BYN по курсу НБРБ на дату; курса нет — так и сказано", () => {
    const usd: AccountListItem = {
      ...cash,
      kind: "card",
      bank: "Альфа-Банк",
      mask: "2208",
      balance: { minor: 32_000, currency: "USD" },
      initialBalance: { minor: 32_000, currency: "USD" },
      balanceInByn: { minor: 95_587, currency: "BYN" },
      rate: { rateE4: 29_871, scale: 1, date: "2026-10-21" as AccountListItem["balanceOn"] },
    };
    renderWithProviders(<AccountCard account={usd} />);
    expect(screen.getByRole("article")).toHaveTextContent(
      /≈ 955,87\sBYN по курсу НБРБ 2,9871 на 21\.10\.2026/,
    );
  });

  it("STMT-09: курса нет — эквивалент не показан, сказано почему", () => {
    renderWithProviders(
      <AccountCard
        account={{
          ...cash,
          kind: "card",
          balance: { minor: 1, currency: "EUR" },
          initialBalance: { minor: 1, currency: "EUR" },
        }}
      />,
    );
    expect(screen.getByRole("article")).toHaveTextContent("Курс НБРБ на сегодня недоступен");
  });

  it("RCPT-10: «Карта, не указана» — служебный счёт с пояснением", () => {
    renderWithProviders(<AccountCard account={{ ...cash, kind: "unknown-card" }} />);
    const card = screen.getByRole("article", { name: "Карта, не указана" });
    expect(card).toHaveTextContent("Служебный счёт для чеков");
    expect(card).toHaveTextContent("Сюда попадают чеки");
  });
});
