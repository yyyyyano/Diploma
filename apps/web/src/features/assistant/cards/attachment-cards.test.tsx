// CHAT-03, CHAT-04: вложения (карточки чека и выписки), реестр частей и безопасный запасной вид. Сеть — MSW.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../../test/msw.ts";
import { renderWithProviders } from "../../../test/render.tsx";
import { MessageView } from "../MessageView.tsx";
import { AttachmentCard } from "./AttachmentCard.tsx";

const ACCOUNT = "0190f0a0-0000-7000-8000-0000000000c1";
const MESSAGE = "0190f0a0-0000-7000-8000-0000000000b1";
const RECEIPT = "0190f0a0-0000-7000-8000-0000000000e1";
const IMPORT = "0190f0a0-0000-7000-8000-0000000000e2";

function render(ui: ReactElement) {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: "/", component: () => ui });
  const stub = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, stub("/operations"), stub("/documents")]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const conflict = {
  defined: true,
  code: "CONFLICT",
  status: 409,
  message: "CONFLICT",
  data: { requestId: "req-00000001", params: {} },
};

describe("CHAT-03: вложения — карточки чека и выписки", () => {
  const money = (minor: number) => ({ minor, currency: "BYN" });
  const receiptCard = (status: string) => ({
    receipt: {
      id: RECEIPT,
      status,
      stage: null,
      disputedLines: [],
      errorCode: null,
      duplicateOf: null,
      storeName: "Евроопт",
      purchaseDate: "2026-10-20",
      purchaseTime: null,
      total: money(847),
      confirmed: false,
      rechecks: 0,
      createdAt: "2026-10-31T09:00:00.000Z",
    },
    unp: null,
    address: null,
    payment: null,
    receiptDiscount: money(0),
    remainder: money(0),
    mismatches: [],
    items: [
      {
        position: 1,
        name: "Молоко",
        normalizedName: "молоко",
        unit: null,
        quantityMilli: 1000,
        unitPrice: money(249),
        discount: money(0),
        lineTotal: money(249),
        disputed: false,
        category: null,
        warranty: false,
      },
    ],
    attempts: [],
    fileId: ACCOUNT,
    operation: null,
    mns: null,
    traceId: null,
  });

  it("чек: магазин, позиции, итог, статус; «Открыть чек» ведёт в «Чеки и документы»", async () => {
    server.use(http.get(`*/api/receipts/${RECEIPT}`, () => HttpResponse.json(receiptCard("ok"))));
    const router = render(<AttachmentCard data={{ kind: "receipt", id: RECEIPT }} />);
    const card = await screen.findByRole("article", { name: "Евроопт" });
    expect(card).toHaveTextContent("Молоко");
    expect(card).toHaveTextContent("Сумма сходится 100%");
    expect(card).toHaveTextContent(/8,47\sBYN/);
    await userEvent.click(within(card).getByRole("link", { name: "Открыть чек" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/documents"));
    expect(router.state.location.search).toEqual({ open: RECEIPT });
  });

  it("чек ещё читается — статус «Распознаётся»", async () => {
    server.use(
      http.get(`*/api/receipts/${RECEIPT}`, () => HttpResponse.json(receiptCard("processing"))),
    );
    render(<AttachmentCard data={{ kind: "receipt", id: RECEIPT }} />);
    expect(await screen.findByText("Распознаётся")).toBeInTheDocument();
  });

  it("чужой или удалённый чек (NOT_FOUND) — «Файл не найден», данных нет", async () => {
    server.use(
      http.get(`*/api/receipts/${RECEIPT}`, () =>
        HttpResponse.json({ ...conflict, code: "NOT_FOUND", status: 404 }, { status: 404 }),
      ),
    );
    render(<AttachmentCard data={{ kind: "receipt", id: RECEIPT }} />);
    expect(await screen.findByText(/Файл не найден/)).toBeInTheDocument();
  });

  it("выписка: банк, статус словами, число найденных операций, ссылка на предпросмотр", async () => {
    server.use(
      http.get(`*/api/statements/imports/${IMPORT}`, () =>
        HttpResponse.json({
          summary: {
            id: IMPORT,
            fileId: ACCOUNT,
            status: "ready",
            bank: "Приорбанк",
            mask: null,
            currency: "BYN",
            period: null,
            found: 17,
            newCount: 15,
            duplicates: 2,
            doubtful: 0,
            skipped: 0,
            method: "detected",
            formatChanged: false,
            balance: null,
            warnings: [],
            errorCode: null,
            accountId: null,
            createdAt: "2026-10-31T09:00:00.000Z",
            importedAt: null,
          },
          rows: [],
          columns: null,
        }),
      ),
    );
    const router = render(<AttachmentCard data={{ kind: "statement", id: IMPORT }} />);
    const card = await screen.findByRole("article", { name: "Выписка" });
    expect(card).toHaveTextContent("Приорбанк");
    expect(card).toHaveTextContent("Статус: Готова к импорту");
    expect(card).toHaveTextContent("Найдено операций: 17, новых: 15");
    await userEvent.click(within(card).getByRole("link", { name: "Открыть выписку" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ import: IMPORT }));
  });
});

describe("CHAT-04: реестр частей и безопасный запасной вид", () => {
  const answer = (parts: unknown[], metadata: object = {}) => ({
    id: MESSAGE,
    role: "assistant" as const,
    parts: parts as never,
    metadata,
  });

  it("часть неизвестного вида data-… не роняет ответ: вместо неё — запасной вид, остальное на месте", async () => {
    render(
      <MessageView
        message={answer([
          { type: "text", text: "Вот результат." },
          { type: "data-unknown", data: { secret: "не показывать" } },
        ])}
      />,
    );
    expect(await screen.findByText("Вот результат.")).toBeInTheDocument();
    expect(screen.getByText(/Карточка недоступна/)).toBeInTheDocument();
    expect(screen.queryByText(/не показывать/)).toBeNull();
  });

  it("данные-часть не по схеме — запасной вид; сбой инструмента — «Шаг не удался», без карточки", async () => {
    render(
      <MessageView
        message={answer([
          { type: "data-chart", data: { title: "x" } },
          {
            type: "tool-add_transaction",
            toolCallId: "c1",
            state: "output-available",
            input: {},
            output: { ok: false },
          },
        ])}
      />,
    );
    expect(await screen.findByText(/Карточка недоступна/)).toBeInTheDocument();
    expect(screen.getByText(/Шаг не удался/)).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /Записал/ })).toBeNull();
  });

  it("CHAT-10: ответ со статьёй, изменившейся позже, помечен и предлагает спросить заново", async () => {
    let asked = 0;
    render(
      <MessageView
        message={answer([{ type: "text", text: "Срок — 14 дней." }], { changedVersionIds: ["12"] })}
        onReask={() => (asked += 1)}
      />,
    );
    expect(await screen.findByText("Статья изменилась после ответа")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Спросить заново" }));
    expect(asked).toBe(1);
  });

  it("без изменений в статьях пометки нет", async () => {
    render(<MessageView message={answer([{ type: "text", text: "Срок — 14 дней." }])} />);
    expect(await screen.findByText("Срок — 14 дней.")).toBeInTheDocument();
    expect(screen.queryByText("Статья изменилась после ответа")).toBeNull();
  });
});
