// DES-16, REC-01…05, EXPL-01, P5: «Регулярные платежи» — четыре состояния; разделы с итогами; решения по предположениям
// и «возможно прекращён» сразу и с «Отменить»; исправить, добавить вручную, вернуть прекращённый; ⓘ → расчёт средней суммы;
// вкладка-фильтр живёт в адресе.
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
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { RecurringSearch } from "./model/search.ts";
import { RecurringPage } from "./RecurringPage.tsx";

const TOKEN = "0199f0a0-0000-7000-8000-0000000000aa";
const TRACE = "0199f0a0-0000-7000-8000-0000000000bb";
const ID = (n: number) => `0199f0a0-0000-7000-8000-00000000010${n}`;
const byn = (minor: number) => ({ minor, currency: "BYN" });

function item(over: Record<string, unknown>) {
  return {
    id: ID(1),
    name: "Беларусбанк кредит",
    flow: "expense",
    section: "mandatory",
    period: "month",
    state: "active",
    source: "detected",
    anchorDay: 23,
    amount: byn(41_000),
    amountIsManual: false,
    amountRange: null,
    monthly: byn(41_000),
    nextExpectedOn: "2026-11-23",
    lastOccurredOn: "2026-10-23",
    overdueDays: null,
    repeats: 6,
    categoryCode: "loans",
    categoryId: null,
    counted: true,
    ...over,
  };
}

const salary = item({
  id: ID(2),
  name: "ООО «ТехноСофт»",
  flow: "income",
  section: "income",
  anchorDay: 25,
  amount: byn(144_000),
  monthly: byn(144_000),
  nextExpectedOn: "2026-10-30",
  categoryCode: "salary",
});
const credit = item({});
const utilities = item({
  id: ID(3),
  name: "ЕРИП Расчёт ЖКУ",
  anchorDay: 14,
  amount: byn(18_640),
  amountRange: { min: byn(17_210), max: byn(20_140) },
  monthly: byn(18_640),
  categoryCode: "utilities",
});
const yandex = item({
  id: ID(4),
  name: "Яндекс Плюс",
  section: "subscriptions",
  anchorDay: 1,
  amount: byn(1_599),
  monthly: byn(1_599),
  categoryCode: "subscriptions",
});
const club = item({
  id: ID(5),
  name: "Центр РобоКлуб",
  section: "other",
  state: "suggested",
  anchorDay: 9,
  amount: byn(6_000),
  monthly: byn(6_000),
  counted: false,
  categoryCode: "kids",
});
const gym = item({
  id: ID(6),
  name: "Клуб Атлетик",
  section: "other",
  state: "maybe-ended",
  anchorDay: 12,
  amount: byn(5_500),
  monthly: byn(5_500),
  counted: false,
  nextExpectedOn: "2026-10-12",
  overdueDays: 16,
  categoryCode: "leisure",
});
const stopped = item({ id: ID(7), name: "Старый журнал", state: "ended", counted: false });

const TOTALS = [
  { section: "income", monthly: byn(240_000), yearly: byn(2_880_000) },
  { section: "mandatory", monthly: byn(59_640), yearly: byn(715_680) },
  { section: "subscriptions", monthly: byn(1_599), yearly: byn(19_188) },
  { section: "other", monthly: null, yearly: null },
];

function list(items: readonly unknown[]) {
  return http.get("*/api/recurring", () =>
    HttpResponse.json({ onDate: "2026-10-28", items, totals: TOTALS }),
  );
}

const changed = (over: Record<string, unknown>) =>
  HttpResponse.json({ item: item(over), undoToken: TOKEN });

function renderPage(path = "/recurring") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/recurring",
    validateSearch: RecurringSearch,
    component: () => <RecurringPage search={route.useSearch()} />,
  });
  const operations = createRoute({
    getParentRoute: () => root,
    path: "/operations",
    component: () => <p>Операции</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([route, operations]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

const all = [salary, credit, utilities, yandex, club, gym, stopped];

describe("DES-16: состояния экрана «Регулярные платежи»", () => {
  it("загрузка — скелетоны с «Загрузка…» для экранного диктора", async () => {
    server.use(
      http.get("*/api/recurring", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderPage();
    expect(await screen.findAllByText("Загрузка…")).not.toHaveLength(0);
  });

  it("пусто — что здесь будет и «Добавить вручную»", async () => {
    server.use(list([]));
    renderPage();
    expect(await screen.findByText("Регулярных платежей пока нет")).toBeInTheDocument();
  });

  it("ошибка — что случилось и «Обновить»", async () => {
    server.use(http.get("*/api/recurring", () => HttpResponse.json({}, { status: 500 })));
    renderPage();
    expect(
      await screen.findByText("Не получилось загрузить регулярные платежи"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить" })).toBeInTheDocument();
  });

  it("успех — разделы с итогами, период, сумма, следующая дата и состояние", async () => {
    server.use(list(all));
    renderPage();
    const incomes = await screen.findByRole("region", { name: "Доходы" });
    expect(within(incomes).getByText("ООО «ТехноСофт»")).toBeInTheDocument();
    expect(within(incomes).getByText("Ежемесячно, 25-го")).toBeInTheDocument();
    expect(within(incomes).getByText("Следующий — 30.10.2026")).toBeInTheDocument();
    expect(within(incomes).getByText(/2\s400,00/)).toBeInTheDocument();
    const mandatory = screen.getByRole("region", { name: "Обязательные платежи" });
    expect(within(mandatory).getByText(/596,40/)).toBeInTheDocument();
    expect(within(mandatory).getByText("ЕРИП Расчёт ЖКУ")).toBeInTheDocument();
    const subs = screen.getByRole("region", { name: "Подписки" });
    expect(within(subs).getByText("подписка")).toBeInTheDocument();
    expect(within(subs).getByText(/191,88 BYN в год/)).toBeInTheDocument();
    expect(
      screen.getByText("Найдены по истории операций · обновлено 28.10.2026"),
    ).toBeInTheDocument();
  });

  it("ЖКХ с разной суммой: «≈», разброс «от … до» и ⓘ с расчётом", async () => {
    server.use(
      list(all),
      http.post("*/api/recurring/explain", () => HttpResponse.json({ traceId: TRACE })),
      http.get("*/api/explain", () =>
        HttpResponse.json({
          id: TRACE,
          trace: {
            key: "recurring.averageAmount",
            op: "avg",
            value: byn(18_640),
            inputs: [],
            refs: [{ kind: "transaction", id: ID(9) }],
          },
          period: { from: "2026-08-14", to: "2026-10-14" },
          createdAt: "2026-10-28T09:00:00Z",
        }),
      ),
    );
    renderPage();
    const mandatory = await screen.findByRole("region", { name: "Обязательные платежи" });
    expect(within(mandatory).getByText("от 172,10 BYN до 201,40 BYN")).toBeInTheDocument();
    await userEvent.click(
      within(mandatory).getByRole("button", {
        name: /Откуда средняя сумма платежа «ЕРИП Расчёт ЖКУ»/,
      }),
    );
    expect(await screen.findByText("Откуда эта цифра?")).toBeInTheDocument();
  });

  it("«Другие регулярные» — предположение, «возможно прекращён» со сроком, прекращённые — отдельным блоком", async () => {
    server.use(list(all));
    renderPage();
    const others = await screen.findByRole("region", { name: "Другие регулярные" });
    expect(within(others).getByText("предположение")).toBeInTheDocument();
    expect(within(others).getByText("возможно прекращён")).toBeInTheDocument();
    expect(within(others).getByText("Ожидался 12.10.2026")).toBeInTheDocument();
    expect(within(others).getByText("не пришёл 16 дней")).toBeInTheDocument();
    const ended = screen.getByRole("region", { name: "Прекращённые" });
    expect(within(ended).getByText("Старый журнал")).toBeInTheDocument();
  });
});

describe("REC-02, REC-05, P5: решения человека", () => {
  it("«Да, регулярный» — сразу, с «Отменить»", async () => {
    let body: unknown;
    server.use(
      list(all),
      http.post("*/api/recurring/confirm", async ({ request }) => {
        body = await request.json();
        return changed({ id: ID(5), name: "Центр РобоКлуб", state: "active" });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Да, регулярный" }));
    expect(await screen.findByText("«Центр РобоКлуб» — регулярный платёж")).toBeInTheDocument();
    expect(body).toEqual({ id: ID(5) });
    expect(screen.getByRole("button", { name: "Отменить" })).toBeInTheDocument();
  });

  it("«Это не регулярный» исключает платёж", async () => {
    let body: unknown;
    server.use(
      list(all),
      http.post("*/api/recurring/exclude", async ({ request }) => {
        body = await request.json();
        return changed({ id: ID(5), name: "Центр РобоКлуб", state: "excluded" });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Это не регулярный" }));
    expect(
      await screen.findByText("«Центр РобоКлуб» больше не считается регулярным"),
    ).toBeInTheDocument();
    expect(body).toEqual({ id: ID(5) });
  });

  it("REC-05: «Платёж не пришёл в срок» — «Да, прекращён» и «Ещё придёт»", async () => {
    const calls: string[] = [];
    server.use(
      list(all),
      http.post("*/api/recurring/end", () => {
        calls.push("end");
        return changed({ id: ID(6), name: "Клуб Атлетик", state: "ended" });
      }),
      http.post("*/api/recurring/still-coming", () => {
        calls.push("still");
        return changed({ id: ID(6), name: "Клуб Атлетик", state: "active" });
      }),
    );
    renderPage();
    const card = (await screen.findByText("Платёж не пришёл в срок")).closest(
      "article",
    ) as HTMLElement;
    expect(
      within(card).getByText(/Клуб Атлетик, 55,00 BYN, ожидался 12.10.2026 — прошло 16 дней/),
    ).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Ещё придёт" }));
    await waitFor(() => expect(calls).toEqual(["still"]));
    await userEvent.click(within(card).getByRole("button", { name: "Да, прекращён" }));
    await waitFor(() => expect(calls).toEqual(["still", "end"]));
  });

  it("«Вернуть в регулярные» — у прекращённого", async () => {
    let body: unknown;
    server.use(
      list(all),
      http.post("*/api/recurring/resume", async ({ request }) => {
        body = await request.json();
        return changed({ id: ID(7), name: "Старый журнал" });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Вернуть в регулярные" }));
    expect(await screen.findByText("«Старый журнал» снова в регулярных")).toBeInTheDocument();
    expect(body).toEqual({ id: ID(7) });
  });

  it("меню строки: «Исправить сумму и дату» отправляет новую сумму и день", async () => {
    let body: unknown;
    server.use(
      list(all),
      http.post("*/api/recurring/edit", async ({ request }) => {
        body = await request.json();
        return changed({ name: "Беларусбанк кредит" });
      }),
    );
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Действия с платежом «Беларусбанк кредит»" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Исправить сумму и дату" }));
    const amount = await screen.findByLabelText("Сумма, BYN");
    await userEvent.clear(amount);
    await userEvent.type(amount, "450,00");
    const day = screen.getByLabelText("День месяца");
    await userEvent.clear(day);
    await userEvent.type(day, "20");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(body).toEqual({ id: ID(1), amount: byn(45_000), period: "month", anchorDay: 20 }),
    );
    expect(await screen.findByText("«Беларусбанк кредит» исправлен")).toBeInTheDocument();
  });

  it("«Добавить вручную»: нужны название и сумма больше нуля; платёж уходит на сервер", async () => {
    let body: unknown;
    server.use(
      list(all),
      http.post("*/api/recurring/create", async ({ request }) => {
        body = await request.json();
        return changed({ name: "Аренда гаража" });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Добавить вручную" }));
    expect(screen.getByRole("button", { name: "Добавить" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Получатель или название"), "Аренда гаража");
    await userEvent.type(screen.getByLabelText("Сумма, BYN"), "120");
    await userEvent.type(screen.getByLabelText("День"), "30");
    await userEvent.click(screen.getByRole("button", { name: "Добавить" }));
    await waitFor(() =>
      expect(body).toEqual({
        name: "Аренда гаража",
        section: "mandatory",
        amount: byn(12_000),
        period: "month",
        anchorDay: 30,
      }),
    );
  });

  it("ошибка сервера при решении — что случилось, список на месте", async () => {
    server.use(
      list(all),
      http.post("*/api/recurring/confirm", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "CONFLICT",
            status: 409,
            message: "CONFLICT",
            data: { requestId: "r", params: {} },
          },
          { status: 409 },
        ),
      ),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Да, регулярный" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не получилось");
  });
});

describe("REC-02: вкладки-фильтр в адресе", () => {
  it("«Подписки» оставляют только свой раздел; «Все» возвращают остальные", async () => {
    server.use(list(all));
    const { router } = renderPage("/recurring?section=subscriptions");
    await screen.findByRole("region", { name: "Подписки" });
    expect(screen.queryByRole("region", { name: "Доходы" })).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Все" }));
    expect(await screen.findByRole("region", { name: "Доходы" })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({});
  });

  it("неверное значение в адресе отбрасывается — показаны все разделы", async () => {
    server.use(list(all));
    renderPage("/recurring?section=bogus");
    expect(await screen.findByRole("region", { name: "Доходы" })).toBeInTheDocument();
  });

  it("«Показать операции» ведёт в «Операции» с поиском по названию", async () => {
    server.use(list(all));
    const { router } = renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Действия с платежом «Яндекс Плюс»" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Показать операции" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/operations"));
    expect(router.state.location.search).toMatchObject({ q: "Яндекс Плюс" });
  });
});
