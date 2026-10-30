// LEGAL-11, LAW-07, LEGAL-06, DES-16: каталог «Базы законов» — состояния экрана, группы по темам со статусом, поиск по
// названию, «ст. 210 НК» → переход в читалку, фильтры в адресе; гость видит страницу без меню (вид guest).
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
import { delay, http, HttpResponse, type JsonBodyType } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { LawsPage } from "./LawsPage.tsx";
import { LawsSearch } from "./model/search.ts";

const act = (over: Record<string, unknown>) => ({
  pravoId: "H10200090",
  title: "Закон Республики Беларусь «О защите прав потребителей»",
  kind: "law",
  shortName: "Закон о защите прав потребителей",
  status: "active",
  repealedOn: null,
  editionOn: "2026-10-21",
  group: "consumer",
  isNpa: true,
  hasText: true,
  ...over,
});

const ACTS = [
  act({}),
  act({
    pravoId: "Hk0900071",
    title: "Налоговый кодекс Республики Беларусь (Особенная часть)",
    kind: "code",
    shortName: "НК (Особенная часть)",
    status: "has-changes",
    group: "taxes",
  }),
  act({
    pravoId: "C20200778",
    title: "Постановление Совета Министров № 778 (перечни невозвратных товаров)",
    kind: "resolution",
    shortName: null,
    status: "card-only",
    editionOn: null,
    hasText: false,
    group: "consumer",
  }),
];

const CATALOG = {
  acts: ACTS,
  counts: { total: 3, withText: 2, cardOnly: 1, withChanges: 1 },
  editionOn: "2026-10-21",
};

const catalog = (body: JsonBodyType = CATALOG) =>
  http.get("*/api/legal-base/catalog", () => HttpResponse.json(body));

const guest = () =>
  http.get("*/api/identity/me", () =>
    HttpResponse.json(
      {
        defined: false,
        code: "UNAUTHORIZED",
        status: 401,
        message: "UNAUTHORIZED",
        data: { requestId: "req-00000001", params: {} },
      },
      { status: 401 },
    ),
  );

function renderPage(initial = "/laws") {
  const root = createRootRoute();
  const lawsRoute = createRoute({
    getParentRoute: () => root,
    path: "/laws",
    validateSearch: LawsSearch,
    component: () => <LawsPage search={lawsRoute.useSearch()} />,
  });
  const routes = [
    lawsRoute,
    createRoute({
      getParentRoute: () => root,
      path: "/laws/$pravoId",
      component: () => <p>читалка</p>,
    }),
    createRoute({ getParentRoute: () => root, path: "/login", component: () => null }),
    createRoute({ getParentRoute: () => root, path: "/register", component: () => null }),
  ];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [initial] }),
    context: {
      session: { current: async () => undefined, signOut: async () => undefined },
      queryClient,
    } as never,
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("DES-16: состояния экрана", () => {
  it("загрузка — скелетоны", async () => {
    server.use(
      guest(),
      http.get("*/api/legal-base/catalog", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderPage();
    expect(await screen.findAllByText("Загрузка…")).not.toHaveLength(0);
  });

  it("ошибка — что случилось; «Попробовать ещё раз» загружает снова", async () => {
    let fail = true;
    server.use(
      guest(),
      http.get("*/api/legal-base/catalog", () =>
        fail
          ? HttpResponse.json(
              {
                defined: false,
                code: "INTERNAL",
                status: 500,
                message: "INTERNAL",
                data: { requestId: "req-00000001", params: {} },
              },
              { status: 500 },
            )
          : HttpResponse.json(CATALOG),
      ),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Не удалось загрузить базу законов" }),
    ).toBeVisible();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Попробовать ещё раз" }));
    expect(await screen.findByRole("heading", { name: "Потребители" })).toBeVisible();
  });

  it("пусто — объясняет, откуда возьмутся акты", async () => {
    server.use(
      guest(),
      catalog({
        acts: [],
        counts: { total: 0, withText: 0, cardOnly: 0, withChanges: 0 },
        editionOn: null,
      }),
    );
    renderPage();
    expect(await screen.findByRole("heading", { name: "В базе пока нет актов" })).toBeVisible();
  });
});

describe("LAW-07, LEGAL-06: каталог по темам", () => {
  it("гость: заголовок экрана гостя, группы по темам, статус словами, «только карточка» и сводка", async () => {
    server.use(guest(), catalog());
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: /простым поиском/u }),
    ).toBeVisible();
    const consumers = (await screen.findByRole("heading", { name: "Потребители" })).closest(
      "section",
    );
    expect(within(consumers as HTMLElement).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Есть изменения", { selector: "span" })).toBeVisible();
    expect(screen.getByText("Только карточка", { selector: "span" })).toBeVisible();
    expect(screen.getByText("Актов: 3")).toBeVisible();
    expect(screen.getByText("Редакция на 21.10.2026")).toBeVisible();
    // Название акта — ссылка в читалку, рядом — ссылка на pravo.by.
    expect(screen.getByRole("link", { name: /^Налоговый кодекс/u })).toHaveAttribute(
      "href",
      "/laws/Hk0900071",
    );
    expect(screen.getAllByRole("link", { name: /Открыть на pravo.by/u })[0]).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  it("поиск по названию оставляет подходящие акты; ничего не нашлось — подсказка и сброс", async () => {
    server.use(guest(), catalog());
    renderPage();
    await screen.findByRole("heading", { name: "Потребители" });
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Поиск по базе законов" }),
      "налоговый",
    );
    expect(screen.queryByRole("heading", { name: "Потребители" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Налоги" })).toBeVisible();
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "несуществующее");
    expect(await screen.findByRole("heading", { name: "Ничего не нашлось" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Сбросить поиск и фильтры" }));
    expect(await screen.findByRole("heading", { name: "Потребители" })).toBeVisible();
  });

  it("фильтры по теме и по состоянию сужают список и попадают в адрес", async () => {
    server.use(guest(), catalog());
    const router = renderPage();
    await screen.findByRole("heading", { name: "Потребители" });
    await userEvent.click(screen.getByRole("button", { name: /^Налоги/u }));
    expect(router.state.location.search).toMatchObject({ group: "taxes" });
    expect(screen.queryByRole("heading", { name: "Потребители" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Все \d/u }));
    await userEvent.click(screen.getByRole("button", { name: "Только карточка" }));
    expect(await screen.findByText(/Постановление Совета Министров № 778/u)).toBeVisible();
    expect(screen.queryByText(/Налоговый кодекс/u)).toBeNull();
  });

  it("«ст. 210 НК»: сервер находит статью — ссылка ведёт в читалку на эту статью", async () => {
    const asked: string[] = [];
    server.use(
      guest(),
      catalog(),
      http.get("*/api/legal-base/resolve", ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("q") ?? "");
        return HttpResponse.json({ target: { pravoId: "Hk0900071", key: "210" } });
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Потребители" });
    await userEvent.type(screen.getByRole("searchbox"), "ст. 210 НК");
    const jump = await screen.findByRole("link", {
      name: /Открыть статью 210 — НК \(Особенная часть\)/u,
    });
    expect(jump).toHaveAttribute("href", expect.stringMatching(/^\/laws\/Hk0900071\?article=/u));
    // Не на каждую букву: сервер спросили один раз, когда набор закончился.
    expect(asked).toEqual(["ст. 210 НК"]);
  });
});
