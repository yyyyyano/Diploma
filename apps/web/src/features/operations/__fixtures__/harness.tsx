// Стенд тестов экрана «Операции»: данные (две операции в BYN и валюте, без курса), ответы счетов и категорий, список с
// записью запросов и отрисовка страницы в настоящем роутере с адресом /operations.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { configure } from "@testing-library/react";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { afterEach } from "vitest";
import { renderWithProviders } from "../../../test/render.tsx";
import { OperationsSearch } from "../model/search.ts";
import { OperationsPage } from "../OperationsPage.tsx";

// Экран тяжёлый, а `make check` гоняет сотни тестов параллельно: первый findBy после холодного импорта ждёт дольше секунды.
configure({ asyncUtilTimeout: 8_000 });

export const CASH = "0190f0a0-0000-7000-8000-0000000000c1";
export const USD = "0190f0a0-0000-7000-8000-0000000000c2";
export const T1 = "0190f0a0-0000-7000-8000-000000000001";
export const T2 = "0190f0a0-0000-7000-8000-000000000002";
export const T3 = "0190f0a0-0000-7000-8000-000000000003";
export const TOKEN = "0199f0a0-0000-7000-8000-0000000000aa";
export const DECISION = "0199f0a0-0000-7000-8000-0000000000dd";
export const TRACE = "0199f0a0-0000-7000-8000-0000000000bb";

const account = (id: string, over: object) => ({
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
});

export const coffee = {
  id: T1,
  accountId: CASH,
  type: "expense",
  direction: "out",
  occurredOn: "2026-10-21",
  occurredTime: "08:47",
  amount: { minor: 650, currency: "BYN" },
  amountInByn: { minor: 650, currency: "BYN" },
  description: "Из чата: «кофе 6,50 наличными»",
  merchantName: "Кофейня «Зерно»",
  note: null,
  category: { type: "system", code: "cafes" },
  categorySource: "user",
  source: "assistant",
  visibility: "personal",
  transferPairId: null,
  refundOfId: null,
  version: 1,
};

export const steam = {
  ...coffee,
  id: T2,
  accountId: USD,
  occurredOn: "2026-10-05",
  occurredTime: null,
  amount: { minor: 999, currency: "USD" },
  amountInByn: { minor: 2984, currency: "BYN" },
  description: "STEAMPOWERED.COM 9.99 USD",
  merchantName: "Steam",
  category: { type: "system", code: "leisure" },
  categorySource: "keyword",
  source: "statement",
};

export const noRate = {
  ...steam,
  id: T3,
  occurredOn: "2026-10-04",
  merchantName: "Wildberries",
  amountInByn: null,
};

const categoryItem = (code: string, icon: string, color: string) => ({
  ref: { type: "system", code },
  kind: "expense",
  name: null,
  icon,
  color,
  hidden: false,
});

export function page(items: readonly unknown[], total = items.length, pageNumber = 1) {
  return { items, page: pageNumber, pageSize: 50, total };
}

/** Запросы, которые экран делает всегда: счета и категории. */
export function baseHandlers() {
  return [
    http.get("*/api/accounts", () =>
      HttpResponse.json({
        onDate: "2026-10-28",
        items: [
          account(CASH, {}),
          account(USD, {
            kind: "card",
            bank: "Альфа-Банк",
            mask: "2208",
            balance: { minor: 1000, currency: "USD" },
          }),
        ],
        totals: { total: null, available: null, missingRates: [] },
      }),
    ),
    http.get("*/api/categories", () =>
      HttpResponse.json({
        items: [
          categoryItem("cafes", "utensils", "cafes"),
          categoryItem("leisure", "ticket", "leisure"),
          categoryItem("taxi", "car-taxi-front", "taxi"),
        ],
      }),
    ),
  ];
}

export const requests: URL[] = [];
afterEach(() => {
  requests.length = 0;
});

/** Список операций: записывает адрес каждого запроса, отвечает по номеру страницы. */
export function list(respond: (url: URL) => JsonBodyType) {
  return http.get("*/api/transactions", ({ request }) => {
    const url = new URL(request.url);
    requests.push(url);
    return HttpResponse.json(respond(url));
  });
}

export function renderPage(path = "/operations") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/operations",
    validateSearch: OperationsSearch,
    component: () => <OperationsPage search={route.useSearch()} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

export function phone() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
