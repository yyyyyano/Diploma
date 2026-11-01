// AGT-05, AGT-07, CHAT-04: карточки действий ассистента — «Записал операцию» с «Отменить / Изменить», итог «Да/Нет» и подтверждение
// массового действия. Сеть — MSW, маршрутизатор — настоящий (ссылка «Изменить»).
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
import { ActionResultCard } from "./ActionResultCard.tsx";
import { ConfirmCard } from "./ConfirmCard.tsx";
import { TransactionResultCard } from "./TransactionResultCard.tsx";

const T1 = "0190f0a0-0000-7000-8000-000000000001";
const ACCOUNT = "0190f0a0-0000-7000-8000-0000000000c1";
const TOKEN = "0199f0a0-0000-7000-8000-0000000000aa";
const DECISION = "0199f0a0-0000-7000-8000-0000000000dd";

const coffee = {
  id: T1,
  accountId: ACCOUNT,
  type: "expense",
  direction: "out",
  occurredOn: "2026-10-31",
  occurredTime: null,
  amount: { minor: 1500, currency: "BYN" },
  amountInByn: { minor: 1500, currency: "BYN" },
  description: "кофе",
  merchantName: "кофе",
  note: null,
  category: { type: "system", code: "cafes" },
  categorySource: "keyword",
  source: "assistant",
  visibility: "personal",
  transferPairId: null,
  refundOfId: null,
  importId: null,
  receiptId: null,
  pending: false,
  needsReview: false,
  version: 1,
};

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

describe("AGT-05: карточка «Записал операцию»", () => {
  const output = {
    transaction: coffee,
    undoToken: TOKEN,
    categoryName: "Кафе, рестораны и доставка",
  };

  it("категория словами, день, сумма; «Изменить» ведёт в список операций с открытой карточкой", async () => {
    const router = render(<TransactionResultCard output={output} changed={false} />);
    const card = await screen.findByRole("article", { name: "Кафе, рестораны и доставка" });
    expect(card).toHaveTextContent("Записал операцию");
    expect(card).toHaveTextContent("31.10.2026");
    expect(card).toHaveTextContent(/15,00\sBYN/);
    await userEvent.click(within(card).getByRole("link", { name: "Изменить" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/operations"));
    expect(router.state.location.search).toEqual({ op: T1 });
  });

  it("«Отменить» шлёт токен в actions.undo; карточка заменяется строкой «Операция отменена»", async () => {
    let body: unknown;
    server.use(
      http.post("*/api/actions/undo", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: "undone" });
      }),
    );
    render(<TransactionResultCard output={output} changed={false} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Отменить запись: Кафе, рестораны и доставка" }),
    );
    expect(await screen.findByText(/Операция отменена/)).toBeInTheDocument();
    expect(body).toEqual({ token: TOKEN });
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("операцию успели поправить (CONFLICT) — причина словами, карточка остаётся", async () => {
    server.use(http.post("*/api/actions/undo", () => HttpResponse.json(conflict, { status: 409 })));
    render(<TransactionResultCard output={output} changed={false} />);
    await userEvent.click(await screen.findByRole("button", { name: /Отменить запись/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не получилось отменить");
    expect(screen.getByRole("article")).toBeInTheDocument();
  });

  it("результат не по схеме — запасной вид без данных части", async () => {
    render(<TransactionResultCard output={{ transaction: { id: 1 } }} changed={false} />);
    expect(await screen.findByText(/Карточка недоступна/)).toBeInTheDocument();
  });
});

describe("AGT-07: итог «Да»/«Нет» без модели", () => {
  it("«Да» с токеном — «Готово» и «Отменить»; «Нет» — «ничего не меняю»", async () => {
    server.use(http.post("*/api/actions/undo", () => HttpResponse.json({ status: "undone" })));
    render(<ActionResultCard data={{ decisionId: DECISION, status: "yes", undoToken: TOKEN }} />);
    expect(await screen.findByText("Готово: действие выполнено.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(await screen.findByText(/Отменено — всё вернулось/)).toBeInTheDocument();
  });

  it("«Нет» — строка без кнопок", async () => {
    render(<ActionResultCard data={{ decisionId: DECISION, status: "no", undoToken: null }} />);
    expect(await screen.findByText("Хорошо, ничего не меняю.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("AGT-07, CHAT-04: подтверждение массового действия", () => {
  const pending = { ok: true, pending: { decisionId: DECISION, count: 23 } };
  const decision = (status: string) =>
    http.get("*/api/actions/decision", () =>
      HttpResponse.json({
        id: DECISION,
        status,
        summary: { key: "decisions.fallback", params: {} },
        createdAt: "2026-10-31T09:00:00.000Z",
      }),
    );

  it("вопрос читается из решения; пока человек не ответил, «Да» не шлётся; «Да» — один ответ в actions.answer и «Отменить»", async () => {
    const answers: unknown[] = [];
    server.use(
      decision("pending"),
      http.post("*/api/actions/answer", async ({ request }) => {
        answers.push(await request.json());
        return HttpResponse.json({ status: "yes", undoToken: TOKEN });
      }),
    );
    render(<ConfirmCard output={pending} />);
    const yes = await screen.findByRole("button", { name: "Да, выполнить (23)" });
    expect(answers).toEqual([]);
    await userEvent.click(yes);
    expect(await screen.findByText("Готово: действие выполнено.")).toBeInTheDocument();
    expect(answers).toEqual([{ id: DECISION, answer: "yes" }]);
    expect(screen.getByRole("button", { name: "Отменить" })).toBeInTheDocument();
  });

  it("«Нет» — отказ без исполнения", async () => {
    server.use(
      decision("pending"),
      http.post("*/api/actions/answer", () => HttpResponse.json({ status: "no", undoToken: null })),
    );
    render(<ConfirmCard output={pending} />);
    await userEvent.click(await screen.findByRole("button", { name: "Нет" }));
    expect(await screen.findByText("Хорошо, ничего не меняю.")).toBeInTheDocument();
  });

  it("решение, на которое уже ответили (текстом «да» или в другой вкладке), — итог без кнопок", async () => {
    server.use(decision("yes"));
    render(<ConfirmCard output={pending} />);
    expect(await screen.findByText("Готово: действие выполнено.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Да, выполнить/ })).toBeNull();
  });

  it("результат без ожидающего решения (сбой инструмента) — ничего не рисуется", () => {
    render(<ConfirmCard output={{ ok: false }} />);
    expect(screen.queryByRole("region")).toBeNull();
  });
});
