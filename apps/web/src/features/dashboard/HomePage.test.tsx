// DES-16, DASH-01…04, EXPL-01, BUD-02: «Главная» — четыре состояния; числа с ⓘ; категория и месяц ведут в «Операции» с
// тем же периодом; период меняет запрос; лимиты и цели; взнос в копилку с «Отменить»; «первые шаги» вместо пустых графиков.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { HomePage } from "./HomePage.tsx";
import { HomeSearch } from "./model/search.ts";

const TOKEN = "0199f0a0-0000-7000-8000-0000000000aa";
const TRACE = (n: number) => `0199f0a0-0000-7000-8000-00000000030${n}`;
const ID = (n: number) => `0199f0a0-0000-7000-8000-00000000040${n}`;
const byn = (minor: number) => ({ minor, currency: "BYN" });

const OVERVIEW = {
  period: { from: "2026-10-01", to: "2026-10-31" },
  today: "2026-10-28",
  hasData: true,
  income: { amount: byn(240_000), traceId: TRACE(1) },
  expense: { amount: byn(184_260), traceId: TRACE(2) },
  missingRates: 0,
  accounts: {
    total: { amount: byn(512_000), traceId: TRACE(3) },
    items: [
      {
        id: ID(1),
        kind: "cash",
        name: null,
        bank: null,
        mask: null,
        currency: "BYN",
        balance: byn(12_000),
        balanceInByn: byn(12_000),
        traceId: TRACE(4),
      },
      {
        id: ID(2),
        kind: "card",
        name: "Карта Лесбанк",
        bank: "Лесбанк",
        mask: "4821",
        currency: "BYN",
        balance: byn(500_000),
        balanceInByn: byn(500_000),
        traceId: TRACE(5),
      },
    ],
  },
  categories: {
    rows: [
      { key: "system:groceries", amount: byn(70_000), traceId: TRACE(6) },
      { key: "system:cafes", amount: byn(16_800), traceId: TRACE(7) },
    ],
    other: { amount: byn(5_000), traceId: TRACE(8), count: 2 },
  },
  months: [
    {
      month: "2026-09",
      income: { amount: byn(240_000), traceId: TRACE(1) },
      expense: { amount: byn(150_000), traceId: TRACE(2) },
    },
    {
      month: "2026-10",
      income: { amount: byn(240_000), traceId: TRACE(1) },
      expense: { amount: byn(184_260), traceId: TRACE(2) },
    },
  ],
  daysLeft: 4,
  limits: [
    {
      id: ID(3),
      categoryKey: "system:cafes",
      limit: byn(20_000),
      spent: byn(16_800),
      remaining: byn(3_200),
      percent: 84,
      traceId: TRACE(9),
      notify80: true,
      notify100: true,
      missingRates: 0,
    },
  ],
  goals: [
    {
      id: ID(4),
      name: "Отпуск",
      kind: "piggy",
      target: byn(300_000),
      deadline: "2027-06-01",
      createdOn: "2026-10-01",
      accountId: null,
      accountMissing: false,
      saved: byn(60_000),
      percent: 20,
      traceId: TRACE(9),
      monthsLeft: 7,
      contribution: byn(34_300),
      contributionTraceId: TRACE(9),
      fitsFreeBalance: true,
      planned: byn(10_000),
      behind: false,
      contributions: [],
    },
  ],
  freeBalance: {
    amount: byn(84_000),
    traceId: TRACE(0),
    months: 3,
    window: { from: "2026-07-01", to: "2026-09-30" },
    reason: null,
  },
  upcoming: [
    {
      id: ID(5),
      name: "ЕРИП Расчёт ЖКУ",
      section: "mandatory",
      on: "2026-10-30",
      amount: byn(18_640),
    },
  ],
};

const overview = (over: Record<string, unknown> = {}) =>
  http.get("*/api/dashboard", () => HttpResponse.json({ ...OVERVIEW, ...over }));

beforeEach(() =>
  server.use(
    http.get("*/api/categories", () =>
      HttpResponse.json({
        items: [
          {
            ref: { type: "system", code: "groceries" },
            kind: "expense",
            name: null,
            icon: "shopping-cart",
            color: "groceries",
            hidden: false,
          },
          {
            ref: { type: "system", code: "cafes" },
            kind: "expense",
            name: null,
            icon: "utensils",
            color: "cafes",
            hidden: false,
          },
        ],
      }),
    ),
  ),
);

function renderPage(path = "/home") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const home = createRoute({
    getParentRoute: () => root,
    path: "/home",
    validateSearch: HomeSearch,
    component: () => <HomePage search={home.useSearch()} />,
  });
  const operations = createRoute({
    getParentRoute: () => root,
    path: "/operations",
    component: () => <p>Операции</p>,
  });
  const documents = createRoute({
    getParentRoute: () => root,
    path: "/documents",
    component: () => <p>Документы</p>,
  });
  const budget = createRoute({
    getParentRoute: () => root,
    path: "/budget",
    component: () => <p>Лимиты</p>,
  });
  const others = ["/recurring", "/accounts"].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => <p>{path}</p> }),
  );
  const router = createRouter({
    routeTree: root.addChildren([home, operations, documents, budget, ...others]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

describe("DES-16: состояния «Главной»", () => {
  it("загрузка — скелетоны с «Загрузка…»", async () => {
    server.use(
      http.get("*/api/dashboard", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderPage();
    expect(await screen.findAllByText("Загрузка…")).not.toHaveLength(0);
  });

  it("ошибка — что случилось и «Повторить»", async () => {
    server.use(http.get("*/api/dashboard", () => HttpResponse.json({}, { status: 500 })));
    renderPage();
    expect(await screen.findByText("Главная не загрузилась")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
  });

  it("DASH-04: новый пользователь — первые шаги со ссылками на документы, а не пустые графики", async () => {
    server.use(
      overview({
        hasData: false,
        accounts: { total: null, items: [] },
        categories: { rows: [], other: null },
        months: [],
        limits: [],
        goals: [],
        upcoming: [],
      }),
    );
    renderPage();
    expect(await screen.findByText("Добро пожаловать в Кошт")).toBeInTheDocument();
    expect(screen.getByText(/Загрузите выписку или сфотографируйте чек/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Загрузить выписку или чек" })).toHaveAttribute(
      "href",
      "/documents",
    );
    expect(screen.queryByText("Траты по категориям")).toBeNull();
  });
});

describe("DASH-02: числа периода", () => {
  it("всего на счетах, доходы, расходы и свободный остаток — с подписями и ⓘ у каждого", async () => {
    server.use(overview());
    renderPage();
    const kpis = await screen.findByRole("region", { name: "Сводка за период" });
    expect(within(kpis).getByText(/5\s120,00/)).toBeInTheDocument();
    expect(within(kpis).getByText(/2\s400,00/)).toBeInTheDocument();
    expect(within(kpis).getByText(/1\s842,60/)).toBeInTheDocument();
    expect(within(kpis).getByText(/840,00/)).toBeInTheDocument();
    expect(within(kpis).getByText(/По данным за 3 мес\./)).toBeInTheDocument();
    for (const subject of [
      "всего на счетах",
      "доходы за период",
      "расходы за период",
      "свободный остаток",
    ]) {
      expect(
        screen.getByRole("button", { name: `Откуда эта цифра: ${subject}` }),
      ).toBeInTheDocument();
    }
  });

  it("свободного остатка нет — причина словами, а не ноль, и без ⓘ", async () => {
    server.use(
      overview({
        freeBalance: {
          amount: null,
          traceId: null,
          months: 0,
          window: null,
          reason: "no-regular-income",
        },
      }),
    );
    renderPage();
    expect(await screen.findByText(/Не нашёл регулярного дохода/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Откуда эта цифра: свободный остаток" }),
    ).toBeNull();
  });

  it("ⓘ открывает сохранённый расчёт числа", async () => {
    server.use(
      overview(),
      http.get("*/api/explain", () =>
        HttpResponse.json({
          id: TRACE(2),
          trace: {
            key: "transactions.expense",
            op: "sum",
            value: byn(184_260),
            inputs: [],
            refs: [],
          },
          period: { from: "2026-10-01", to: "2026-10-31" },
          createdAt: "2026-10-28T09:00:00Z",
        }),
      ),
    );
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Откуда эта цифра: расходы за период" }),
    );
    expect(await screen.findByText("Откуда эта цифра?")).toBeInTheDocument();
  });

  it("категории: ряды с суммами и «Остальное» с числом свёрнутых; кольцо — с таблицей для диктора", async () => {
    server.use(overview());
    renderPage();
    const section = await screen.findByRole("region", { name: "Траты по категориям" });
    expect(
      within(section).getByRole("button", { name: "Показать операции: Продукты" }),
    ).toBeInTheDocument();
    expect(within(section).getAllByText("Остальное")).not.toHaveLength(0);
    expect(within(section).getByText(/2 категории/)).toBeInTheDocument();
    expect(within(section).getByRole("table", { name: "Траты по категориям" })).toBeInTheDocument();
  });
});

describe("DASH-03: переходы в операции", () => {
  it("клик по категории → /operations с периодом и категорией", async () => {
    server.use(overview());
    const { router } = renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Показать операции: Продукты" }),
    );
    expect(await screen.findByText("Операции")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/operations");
    expect(router.state.location.search).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-31",
      category: "system:groceries",
    });
  });

  it("клик по столбцу месяца → /operations за этот месяц и нужного вида (расходы)", async () => {
    server.use(overview());
    const { router } = renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: /Расходы, сентябрь: 1\s500,00/ }),
    );
    await screen.findByText("Операции");
    expect(router.state.location.search).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
      type: "expense",
    });
  });
});

describe("DASH-01: период", () => {
  it("«Предыдущий месяц» меняет адрес и запрос: приходят данные за сентябрь", async () => {
    const asked: string[] = [];
    server.use(
      http.get("*/api/dashboard", ({ request }) => {
        const query = new URL(request.url).searchParams;
        asked.push(query.toString());
        // Сервер отвечает за тот период, который спросили.
        const period = query.has("from")
          ? { from: query.get("from"), to: query.get("to") }
          : OVERVIEW.period;
        return HttpResponse.json({ ...OVERVIEW, period });
      }),
    );
    const { router } = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Предыдущий месяц" }));
    await screen.findByText("Сентябрь 2026");
    expect(router.state.location.search).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(asked.at(-1)).toContain("2026-09-01");
  });

  it("период из адреса уходит в запрос; свой период подписан датами", async () => {
    const asked: string[] = [];
    server.use(
      http.get("*/api/dashboard", ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json({ ...OVERVIEW, period: { from: "2026-10-05", to: "2026-10-20" } });
      }),
    );
    renderPage("/home?from=2026-10-05&to=2026-10-20");
    expect((await screen.findAllByText("05.10.2026 – 20.10.2026")).length).toBeGreaterThan(0);
    expect(asked[0]).toContain("from=2026-10-05");
  });
});

describe("BUD-02, BUD-04, REC-03: лимиты, цели, платежи, счета", () => {
  it("лимит с полосой и процентом; цель с взносом; ближайший платёж; счёт с названием и ⓘ", async () => {
    server.use(overview());
    renderPage();
    const limits = await screen.findByRole("region", { name: "Лимиты на октябрь" });
    expect(
      within(limits).getByRole("progressbar", { name: "Кафе, рестораны и доставка" }),
    ).toHaveValue(84);
    expect(within(limits).getByText(/84% · осталось 32,00 BYN на 4 дня/)).toBeInTheDocument();
    const goals = screen.getByRole("region", { name: "Цели" });
    expect(within(goals).getByText("Отпуск")).toBeInTheDocument();
    const upcoming = screen.getByRole("region", { name: "Ближайшие платежи" });
    expect(within(upcoming).getByText("ЕРИП Расчёт ЖКУ")).toBeInTheDocument();
    expect(within(upcoming).getByText("30.10.2026")).toBeInTheDocument();
    const accounts = screen.getByRole("region", { name: "Счета" });
    expect(within(accounts).getByText("Карта Лесбанк")).toBeInTheDocument();
    expect(within(accounts).getByText("Наличные")).toBeInTheDocument();
    expect(
      within(accounts).getByRole("button", { name: "Откуда эта цифра: остаток «Карта Лесбанк»" }),
    ).toBeInTheDocument();
  });

  it("взнос в копилку с главной: окно, запрос, «Отменить»", async () => {
    let body: unknown;
    server.use(
      overview(),
      http.post("*/api/budgets/goal/contribute", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ goal: OVERVIEW.goals[0], undoToken: TOKEN });
      }),
    );
    renderPage();
    const goals = await screen.findByRole("region", { name: "Цели" });
    await userEvent.click(within(goals).getByRole("button", { name: "Внести" }));
    await userEvent.type(await screen.findByLabelText("Сумма взноса, BYN"), "200");
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Внести" }),
    );
    expect(await screen.findByText("Отложено 200 BYN на «Отпуск».")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отменить" })).toBeInTheDocument();
    expect(body).toEqual({ goalId: ID(4), amount: byn(20_000) });
  });

  it("нет лимитов и целей — подсказки со ссылками на «Лимиты и цели»", async () => {
    server.use(overview({ limits: [], goals: [], upcoming: [] }));
    renderPage();
    expect(await screen.findByText(/Лимитов пока нет/)).toBeInTheDocument();
    expect(screen.getByText(/Целей пока нет/)).toBeInTheDocument();
    expect(screen.getByText("В ближайшие 30 дней регулярных платежей нет.")).toBeInTheDocument();
  });
});
