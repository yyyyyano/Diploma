// TXN-10, TXN-11, RCPT-10, RCPT-11: чек в карточке операции — ссылка, «ожидает выписки», «одна операция из выписки и чека»,
// ручная связь и разрыв с «Отменить».
import type { Transaction } from "@kosht/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { ReceiptLink } from "./ReceiptLink.tsx";

const TX = "0199f0a0-0000-7000-8000-000000000c01";
const RECEIPT = "0199f0a0-0000-7000-8000-000000000c02";
const TOKEN = "0199f0a0-0000-7000-8000-000000000c03";

const base = {
  id: TX,
  accountId: "0199f0a0-0000-7000-8000-000000000c04",
  type: "expense",
  direction: "out",
  occurredOn: "2026-10-13",
  occurredTime: null,
  amount: { minor: 4730, currency: "BYN" },
  amountInByn: { minor: 4730, currency: "BYN" },
  description: "EVROOPT",
  merchantName: "Евроопт",
  note: null,
  category: null,
  categorySource: null,
  source: "statement",
  visibility: "personal",
  transferPairId: null,
  refundOfId: null,
  importId: null,
  receiptId: null,
  pending: false,
  needsReview: false,
  version: 1,
} as unknown as Transaction;

function renderLink(transaction: Transaction) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: () => <ReceiptLink transaction={transaction} /> });
  const documents = createRoute({
    getParentRoute: () => root,
    path: "/documents",
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([documents]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("TXN-11: связь с чеком из карточки", () => {
  it("операция без чека и не из выписки — блока нет", async () => {
    renderLink({ ...base, source: "manual" });
    // Блок пуст: ни ссылки на чек, ни выбора.
    await waitFor(() => expect(screen.queryByRole("link")).not.toBeInTheDocument());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("предварительная операция чека: ссылка на чек и пояснение «остаток счёта не меняется», разрыва нет", async () => {
    renderLink({ ...base, source: "receipt", receiptId: RECEIPT, pending: true });
    expect(
      await screen.findByText(/платёж в выписке пока не найден, остаток счёта не меняется/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/documents?open=${RECEIPT}`);
    expect(screen.queryByRole("button", { name: "Разорвать связь" })).not.toBeInTheDocument();
  });

  it("операция выписки, слитая с чеком: «Операция одна…» и «Разорвать связь» с «Отменить»", async () => {
    server.use(
      http.delete(`*/api/transactions/${TX}/receipt`, () =>
        HttpResponse.json({ undoToken: TOKEN }),
      ),
    );
    renderLink({ ...base, receiptId: RECEIPT });
    expect(await screen.findByText(/Операция одна: сумма и день — из выписки/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Разорвать связь" }));
    expect(
      await screen.findByText("Связь с чеком разорвана: чек снова отдельная операция."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Отменить/ })).toBeInTheDocument();
  });

  it("расход из выписки без чека: выбрать чек и связать — сумма и день останутся из выписки", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get("*/api/receipts", () =>
        HttpResponse.json({
          items: [
            {
              id: RECEIPT,
              status: "ok",
              stage: null,
              disputedLines: [],
              errorCode: null,
              duplicateOf: null,
              storeName: "Евроопт",
              purchaseDate: "2026-10-12",
              purchaseTime: "14:37",
              total: { minor: 4730, currency: "BYN" },
              confirmed: false,
              rechecks: 0,
              createdAt: "2026-10-12T11:37:00.000Z",
            },
          ],
        }),
      ),
      http.post(`*/api/transactions/${TX}/receipt`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ undoToken: TOKEN });
      }),
    );
    renderLink(base);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("combobox", { name: "Чек" }));
    await user.click(await screen.findByRole("option", { name: /Евроопт · 12\.10\.2026/ }));
    await user.click(screen.getByRole("button", { name: "Связать" }));
    await waitFor(() => expect(bodies).toEqual([{ receiptId: RECEIPT }]));
    expect(await screen.findByText("Операция связана с чеком.")).toBeInTheDocument();
  });

  it("чеков для связи нет — так и сказано", async () => {
    server.use(http.get("*/api/receipts", () => HttpResponse.json({ items: [] })));
    renderLink(base);
    expect(await screen.findByText("Нет чеков для связи.")).toBeInTheDocument();
  });
});
