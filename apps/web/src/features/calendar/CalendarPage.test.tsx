// DES-16, CAL-01, CAL-04, CAL-06, CAL-07, REC-03, P5, AGT-07: «Календарь» — четыре состояния; месяц с событиями, платежами и итогами
// (числа и traceId — с сервера); список «Ближайшие»; карточка события с «Откуда это событие» и напоминаниями; новое событие с
// «Отменить»; удаление только решением «Да/Нет». Сеть — MSW.
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
import { CalendarPage } from "./CalendarPage.tsx";
import type { CalendarSearch } from "./model/search.ts";

const TRACE = "0190f0a0-0000-7000-8000-0000000000a1";
const TOKEN = "0190f0a0-0000-7000-8000-0000000000aa";
const ID = (n: number) => `0190f0a0-0000-7000-8000-00000000030${String(n)}`;
const byn = (minor: number) => ({ minor, currency: "BYN" });

const base = {
  title: null,
  rule: null,
  approx: false,
  traceId: TRACE,
  stored: false,
  remindDays: [],
  canDelete: false,
  ref: null,
};
const credit = {
  ...base,
  id: "recurring:r1:2026-10-23",
  type: "credit",
  title: "Платёж по кредиту, Беларусбанк",
  on: "2026-10-23",
  amount: byn(41_000),
  direction: "out",
  origin: { kind: "recurring", params: { name: "Платёж по кредиту, Беларусбанк" } },
  ref: { entity: "recurring", id: ID(1) },
};
const salary = {
  ...credit,
  id: "recurring:r2:2026-10-25",
  type: "income",
  title: "Зарплата",
  on: "2026-10-25",
  amount: byn(144_000),
  direction: "in",
  origin: { kind: "income", params: { name: "Зарплата" } },
};
const kindergarten = {
  ...base,
  id: ID(5),
  type: "own",
  title: "Оплатить садик",
  on: "2026-10-30",
  amount: null,
  traceId: null,
  direction: null,
  stored: true,
  remindDays: [7, 1],
  canDelete: true,
  origin: { kind: "user", params: {} },
};
const warranty = {
  ...kindergarten,
  id: ID(6),
  type: "warranty",
  title: "Наушники",
  on: "2026-11-18",
  canDelete: false,
  remindDays: [30, 7, 1],
  origin: {
    kind: "warranty",
    params: { store: "Электросила", purchasedOn: "2024-11-18", months: 24 },
  },
  ref: { entity: "receipt", id: ID(7) },
};

const MONTH = {
  today: "2026-10-21",
  month: "2026-10",
  from: "2026-09-28",
  to: "2026-11-01",
  entries: [credit, salary, kindergarten],
  totals: {
    payments: { amount: byn(41_000), traceId: TRACE },
    income: { amount: byn(144_000), traceId: TRACE },
  },
};
const UPCOMING = {
  today: "2026-10-21",
  groups: [
    {
      key: "week-0",
      from: "2026-10-21",
      to: "2026-10-25",
      entries: [credit, salary],
      totals: MONTH.totals,
    },
    {
      key: "month-2026-11",
      from: "2026-11-02",
      to: "2026-11-30",
      entries: [warranty],
      totals: { payments: null, income: null },
    },
  ],
};

const month = (over: Record<string, unknown> = {}) =>
  http.get("*/api/calendar/month", () => HttpResponse.json({ ...MONTH, ...over }));
const upcoming = (over: Record<string, unknown> = {}) =>
  http.get("*/api/calendar/upcoming", () => HttpResponse.json({ ...UPCOMING, ...over }));

function renderPage(search: CalendarSearch = {}) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/calendar",
    component: () => <CalendarPage search={search} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ["/calendar"] }),
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

describe("DES-16: состояния экрана", () => {
  it("загрузка — скелетоны с «Загрузка…» для диктора, заголовок на месте", async () => {
    server.use(
      http.get("*/api/calendar/month", async () => {
        await delay("infinite");
        return HttpResponse.json(MONTH);
      }),
    );
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Календарь" })).toBeInTheDocument();
    expect((await screen.findAllByText("Загрузка…")).length).toBeGreaterThan(0);
  });

  it("ошибка — что случилось и «Повторить»", async () => {
    server.use(http.get("*/api/calendar/month", () => HttpResponse.json({}, { status: 500 })));
    renderPage();
    expect(await screen.findByText("Календарь не загрузился")).toBeInTheDocument();
    server.use(month());
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Октябрь 2026")).toBeInTheDocument();
  });

  it("список без событий — пусто с первым шагом", async () => {
    server.use(upcoming({ groups: [] }));
    renderPage({ view: "list" });
    expect(await screen.findByText("Впереди событий нет")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Добавить событие" }).length).toBeGreaterThan(0);
  });
});

describe("CAL-01, CAL-03: месяц", () => {
  it("название месяца, итоги платежей и поступлений с ⓘ, события в своих днях, дни соседних месяцев серые", async () => {
    server.use(month());
    renderPage();
    expect(await screen.findByText("Октябрь 2026")).toBeInTheDocument();
    expect(screen.getByText("В октябре:")).toBeInTheDocument();
    expect(screen.getByText(/410,00/u)).toBeInTheDocument();
    expect(screen.getByText(/1\D440,00/u)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Откуда эта цифра: Платежи месяца/u }),
    ).toBeInTheDocument();
    const pill = screen.getByRole("button", {
      name: /Платёж по кредиту, Беларусбанк, 23\.10\.2026, 410,00/u,
    });
    expect(pill).toHaveTextContent("−410");
    expect(screen.getByRole("button", { name: /Зарплата, 25\.10\.2026/u })).toHaveTextContent("+1");
    expect(
      screen.getByRole("button", { name: "21 октября, сегодня, событий нет" }),
    ).toBeInTheDocument();
  });

  it("переключатель «Месяц / Список» и стрелки месяцев меняют адрес", async () => {
    server.use(month());
    const router = renderPage();
    await screen.findByText("Октябрь 2026");
    await userEvent.click(screen.getByRole("button", { name: "Следующий месяц" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ month: "2026-11" }));
    await userEvent.click(screen.getByRole("button", { name: "Список" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ view: "list" }));
  });

  it("день с событием открывает панель дня с кнопкой «Добавить событие на этот день»", async () => {
    server.use(month());
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "30 октября, событий: 1" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Оплатить садик")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Добавить событие на этот день" }),
    ).toBeInTheDocument();
  });
});

describe("CAL-01: список «Ближайшие»", () => {
  it("группы с заголовками и суммами; поступление с «+», строка — тип, день недели и «через N дней»", async () => {
    server.use(upcoming());
    renderPage({ view: "list" });
    expect(
      await screen.findByRole("heading", { name: /Эта неделя · 21 октября – 25 октября/u }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ноябрь" })).toBeInTheDocument();
    expect(screen.getByText(/Кредит · пятница · через 2 дня/u)).toBeInTheDocument();
    expect(screen.getByText("Наушники")).toBeInTheDocument();
  });
});

describe("CAL-04, CAL-07: карточка события", () => {
  it("гарантия: «Откуда это событие» — чек, магазин и срок 24 мес.; напоминания за 30, 7 и 1 день включены; ссылка на чек", async () => {
    server.use(upcoming());
    renderPage({ view: "list", event: warranty.id });
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/По чеку из «Электросила» от 18\.11\.2024: гарантия 24 мес\./u),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "За 30 дней" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "В день события" })).not.toBeChecked();
    expect(within(dialog).getByRole("link", { name: /Чек в разделе/u })).toHaveAttribute(
      "href",
      `/documents?open=${ID(7)}`,
    );
    expect(within(dialog).queryByRole("button", { name: "Удалить событие" })).toBeNull();
  });

  it("выключить «За 1 день» — на сервер уходят оставшиеся дни; ответ с «Отменить»", async () => {
    let body: unknown;
    server.use(
      upcoming(),
      http.post("*/api/calendar/event/update", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ event: { ...warranty, remindDays: [7, 30] }, undoToken: TOKEN });
      }),
    );
    renderPage({ view: "list", event: warranty.id });
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "За 1 день" }));
    await waitFor(() => expect(body).toEqual({ id: warranty.id, remindDays: [7, 30] }));
    expect(await screen.findByText("Событие «Наушники» изменено")).toBeInTheDocument();
  });

  it("платёж из истории: напоминаний нет, строка «Откуда» — по истории; сумма с ⓘ", async () => {
    server.use(month());
    renderPage({ event: credit.id });
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/По истории платежей: «Платёж по кредиту, Беларусбанк»/u),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Напоминания у этого события не настраиваются/u),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /Откуда эта цифра: Сумма события/u }),
    ).toBeInTheDocument();
  });
});

describe("CAL-06, P5: новое событие", () => {
  it("название и день → создаётся с напоминаниями за 7 и 1 день; «Событие … — 01.12.2026» с «Отменить»", async () => {
    let body: unknown;
    server.use(
      month(),
      http.post("*/api/calendar/event", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          event: { ...kindergarten, title: "Оплатить кружок", on: "2026-12-01" },
          undoToken: TOKEN,
        });
      }),
    );
    renderPage();
    await userEvent.click(
      (await screen.findAllByRole("button", { name: "Добавить событие" }))[0] as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Название"), "Оплатить кружок");
    const date = within(dialog).getByLabelText("Дата");
    await userEvent.clear(date);
    await userEvent.type(date, "2026-12-01");
    await userEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await waitFor(() =>
      expect(body).toEqual({
        title: "Оплатить кружок",
        on: "2026-12-01",
        type: "own",
        remindDays: [1, 7],
      }),
    );
    expect(
      await screen.findByText(/Событие «Оплатить кружок» — 01\.12\.2026/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отменить" })).toBeInTheDocument();
  });

  it("без названия «Добавить» недоступно: запрос не уходит", async () => {
    server.use(month());
    renderPage();
    await userEvent.click(
      (await screen.findAllByRole("button", { name: "Добавить событие" }))[0] as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Добавить" })).toBeDisabled();
  });
});

describe("AGT-07: удаление только решением «Да/Нет»", () => {
  it("«Удалить событие» → вопрос из словаря → «Да» → событие удалено с «Отменить»", async () => {
    const DECISION = "0190f0a0-0000-7000-8000-0000000000dd";
    let answered: unknown;
    server.use(
      month(),
      http.post("*/api/calendar/event/delete", () => HttpResponse.json({ decisionId: DECISION })),
      http.get("*/api/actions/decision", () =>
        HttpResponse.json({
          id: DECISION,
          status: "pending",
          summary: { key: "decisions.calendarDelete", params: { title: "Оплатить садик" } },
          createdAt: "2026-10-21T09:00:00.000Z",
        }),
      ),
      http.post("*/api/actions/answer", async ({ request }) => {
        answered = await request.json();
        return HttpResponse.json({ status: "yes", undoToken: TOKEN });
      }),
    );
    renderPage({ event: kindergarten.id });
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: "Удалить событие" }));
    const question = await screen.findByText(/Удалить событие «Оплатить садик»\?/u);
    const confirm = question.closest<HTMLElement>('[role="dialog"]') as HTMLElement;
    await userEvent.click(within(confirm).getByRole("button", { name: "Удалить событие" }));
    await waitFor(() => expect(answered).toEqual({ id: DECISION, answer: "yes" }));
    expect(await screen.findByText("Событие «Оплатить садик» удалено")).toBeInTheDocument();
  });
});
