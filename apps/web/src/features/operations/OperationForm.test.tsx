// TXN-03: счёт по умолчанию подставляется, как только пришёл список счетов (форма могла открыться раньше него).
import type { AccountListItem } from "@kosht/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { server } from "../../test/msw.ts";
import { OperationForm, type FormResult } from "./OperationForm.tsx";

const CASH = "0190f0a0-0000-7000-8000-0000000000c1";
const CARD = "0190f0a0-0000-7000-8000-0000000000c2";

const account = (id: string, over: Partial<AccountListItem>): AccountListItem =>
  ({
    id,
    kind: "cash",
    name: null,
    bank: null,
    mask: null,
    balance: { minor: 0, currency: "BYN" },
    balanceOn: "2026-10-28",
    balanceSource: "operations",
    initialBalance: { minor: 0, currency: "BYN" },
    balanceInByn: null,
    rate: null,
    ...over,
  }) as AccountListItem;

const cash = account(CASH, {});
const card = account(CARD, { kind: "card", bank: "Альфа-Банк", mask: "2208" });

function form(
  accounts: readonly AccountListItem[],
  onSubmit = vi.fn<(result: FormResult) => void>(),
): ReactElement {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <OperationForm
        accounts={accounts}
        today="2026-10-28"
        pending={false}
        onSubmit={onSubmit}
        onCancel={vi.fn<() => void>()}
      />
    </QueryClientProvider>
  );
}

describe("OperationForm: счёт по умолчанию", () => {
  it("список счетов пришёл после открытия формы — счёт подставлен и «Сохранить» доступна", async () => {
    server.use(http.get("*/api/categories", () => HttpResponse.json({ items: [] })));
    const onSubmit = vi.fn<(result: FormResult) => void>();
    const { rerender } = renderWithProviders(form([], onSubmit));
    await userEvent.type(screen.getByLabelText(/Сумма/), "25,00");
    expect(screen.getByRole("combobox", { name: "Счёт" })).toHaveValue("");

    rerender(form([card, cash], onSubmit));

    // По умолчанию — наличные (как при монтировании с готовым списком).
    expect(screen.getByRole("combobox", { name: "Счёт" })).toHaveValue("Наличные");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "create",
        input: expect.objectContaining({ accountId: CASH }),
      }),
    );
  });

  it("выбранный человеком счёт не сбрасывается, когда список обновился", async () => {
    server.use(http.get("*/api/categories", () => HttpResponse.json({ items: [] })));
    const { rerender } = renderWithProviders(form([cash, card]));
    await userEvent.click(screen.getByRole("combobox", { name: "Счёт" }));
    await userEvent.click(screen.getByRole("option", { name: /Альфа-Банк/ }));

    rerender(form([cash, card]));

    expect(screen.getByRole("combobox", { name: "Счёт" })).toHaveValue("Альфа-Банк •• 2208");
  });
});
