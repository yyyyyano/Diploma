// LEGAL-05, LEGAL-06, LAW-32, DES-16: читалка акта — оглавление по структуре, текст статьи шрифтом законов, редакция и
// дата снимка, предупреждение о принятых изменениях, акт «только карточка», ошибки и переход по статьям.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse, type JsonBodyType } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { assistantBridge } from "../../lib/assistant-bridge.ts";
import { LawReaderPage } from "./LawReaderPage.tsx";
import { ReaderSearch } from "./model/search.ts";

const VERSION = "0199f0a0-0000-7000-8000-0000000000a1";
const item = (over: Record<string, unknown> = {}) => ({
  pravoId: "Hk0900071",
  title: "Налоговый кодекс Республики Беларусь (Особенная часть)",
  kind: "code",
  shortName: "НК (Особенная часть)",
  status: "has-changes",
  repealedOn: null,
  editionOn: "2026-10-21",
  group: "taxes",
  isNpa: true,
  hasText: true,
  ...over,
});

const VIEW = {
  act: item(),
  fetchedAt: "2026-10-21T01:00:00.000Z",
  url: "https://pravo.by/document/?guid=3871&p0=Hk0900071",
  cardUrl: "https://pravo.by/document/?guid=3961&p0=Hk0900071",
  toc: [
    {
      key: "209",
      kind: "article",
      number: "209",
      heading: "Стандартные налоговые вычеты",
      group: ["Раздел IV", "Глава 16"],
    },
    {
      key: "210",
      kind: "article",
      number: "210",
      heading: "Социальные налоговые вычеты",
      group: ["Раздел IV", "Глава 16"],
    },
    {
      key: "216.1",
      kind: "article",
      number: "216.1",
      heading: "Налоговые ставки",
      group: ["Раздел IV", "Глава 16"],
    },
  ],
  pending: [
    {
      description: "Закон Республики Беларусь от 17 июля 2026 г. № 170-З",
      inForceOn: "2027-01-01",
      articles: ["210"],
    },
  ],
};

const FRAGMENTS = {
  fragments: [
    {
      versionId: VERSION,
      pathKey: "a210",
      heading: "Социальные налоговые вычеты",
      text: "Статья 210. Социальные налоговые вычеты\n1. При определении размера налоговой базы плательщик имеет право на вычеты.",
      excluded: false,
    },
  ],
};

const error = (code: string, status: number) =>
  HttpResponse.json(
    {
      defined: false,
      code,
      status,
      message: code,
      data: { requestId: "req-00000001", params: {} },
    },
    { status },
  );

const USER = { name: "Ирина", email: "irina@example.test", role: "user" as const };

function renderPage(search: Record<string, unknown> = { article: 210 }, signedIn = false) {
  const root = createRootRoute();
  const readerRoute = createRoute({
    getParentRoute: () => root,
    path: "/laws/$pravoId",
    validateSearch: ReaderSearch,
    component: function Page() {
      const { pravoId = "" } = useParams({ strict: false });
      return <LawReaderPage pravoId={pravoId} search={readerRoute.useSearch()} />;
    },
  });
  const routes = [
    readerRoute,
    createRoute({ getParentRoute: () => root, path: "/laws", component: () => null }),
    createRoute({ getParentRoute: () => root, path: "/login", component: () => null }),
  ];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const query = new URLSearchParams(
    Object.entries(search).map(([k, v]) => [k, JSON.stringify(v)]),
  ).toString();
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [`/laws/Hk0900071?${query}`] }),
    context: {
      session: {
        current: async () => (signedIn ? USER : undefined),
        signOut: async () => undefined,
      },
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

const act = (view: JsonBodyType = VIEW) =>
  http.get("*/api/legal-base/act", () => HttpResponse.json(view));
const fragments = (body: JsonBodyType = FRAGMENTS) =>
  http.get("*/api/legal-base/fragments", () => HttpResponse.json(body));

describe("DES-16: состояния читалки", () => {
  it("загрузка — скелетоны", async () => {
    server.use(
      http.get("*/api/legal-base/act", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderPage();
    expect(await screen.findAllByText("Загрузка…")).not.toHaveLength(0);
  });

  it("акта нет в базе — понятный ответ и путь к каталогу", async () => {
    server.use(http.get("*/api/legal-base/act", () => error("NOT_FOUND", 404)));
    renderPage();
    expect(await screen.findByRole("heading", { name: "Такого акта нет в базе" })).toBeVisible();
    expect(screen.getByRole("link", { name: "К каталогу" })).toHaveAttribute("href", "/laws");
  });

  it("сбой сервера — ошибка с повтором", async () => {
    let fail = true;
    server.use(
      http.get("*/api/legal-base/act", () =>
        fail ? error("INTERNAL", 500) : HttpResponse.json(VIEW),
      ),
      fragments(),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Не удалось загрузить базу законов" }),
    ).toBeVisible();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Попробовать ещё раз" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: /Налоговый кодекс/u }),
    ).toBeVisible();
  });
});

describe("LEGAL-05: читалка", () => {
  it("редакция на дату снимка, дата получения, ссылки на pravo.by и оглавление по разделам", async () => {
    server.use(act(), fragments());
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: /Налоговый кодекс/u }),
    ).toBeVisible();
    expect(screen.getByText("Редакция по состоянию на 21.10.2026")).toBeVisible();
    expect(screen.getByText("Текст получен с pravo.by 21.10.2026")).toBeVisible();
    for (const link of screen.getAllByRole("link", { name: /Открыть на pravo.by/u })) {
      expect(link).toHaveAttribute("href", VIEW.url);
    }
    const toc = screen.getByRole("navigation", { name: "Оглавление" });
    expect(within(toc).getByRole("heading", { name: "Раздел IV · Глава 16" })).toBeVisible();
    expect(within(toc).getByRole("link", { name: /Ст\. 216¹/u })).toBeVisible();
    expect(within(toc).getByRole("link", { name: /Ст\. 210/u })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("текст статьи: заголовок статьи и абзацы; ссылки «следующая» и «предыдущая» ведут по оглавлению", async () => {
    server.use(act(), fragments());
    renderPage();
    const article = await screen.findByRole("article", { name: "Текст акта" });
    expect(
      await within(article).findByRole("heading", {
        level: 2,
        name: "Статья 210. Социальные налоговые вычеты",
      }),
    ).toBeVisible();
    expect(within(article).getByText(/1\. При определении размера налоговой базы/u)).toBeVisible();
    expect(within(article).getByRole("link", { name: "Предыдущая статья" })).toHaveAttribute(
      "href",
      expect.stringContaining("209"),
    );
    expect(within(article).getByRole("link", { name: "Следующая статья" })).toHaveAttribute(
      "href",
      expect.stringContaining("216.1"),
    );
  });

  it("LAW-32: принятые, но не вошедшие изменения — предупреждение с актом, статьями и датой вступления", async () => {
    server.use(act(), fragments());
    renderPage();
    const notes = await screen.findAllByRole("note");
    expect(notes[0]).toHaveTextContent(
      "Принят акт, изменяющий этот: Закон Республики Беларусь от 17 июля 2026 г. № 170-З",
    );
    expect(notes[0]).toHaveTextContent("Содержание изменений в базе отсутствует");
    expect(notes[0]).toHaveTextContent("Затронуты статьи: 210");
    expect(notes[0]).toHaveTextContent("Вступает в силу 01.01.2027");
  });

  it("без номера статьи в адресе открывается первая статья оглавления", async () => {
    let asked = "";
    server.use(
      act(),
      http.get("*/api/legal-base/fragments", ({ request }) => {
        asked = new URL(request.url).searchParams.get("key") ?? "";
        return HttpResponse.json(FRAGMENTS);
      }),
    );
    renderPage({});
    await screen.findByRole("article", { name: "Текст акта" });
    await screen.findByText(/1\. При определении/u);
    expect(asked).toBe("209");
  });

  it("исключённая статья — честная пометка", async () => {
    server.use(act(), fragments({ fragments: [{ ...FRAGMENTS.fragments[0], excluded: true }] }));
    renderPage();
    expect(
      await screen.findByText("Исключена: в действующей редакции статья не действует."),
    ).toBeVisible();
  });

  it("LEGAL-06: акт «только карточка» — без текста, со ссылкой на карточку pravo.by", async () => {
    server.use(
      act({
        ...VIEW,
        act: item({ hasText: false, status: "card-only", editionOn: null }),
        fetchedAt: null,
        toc: [],
        pending: [],
      }),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Текста этого акта в базе нет" }),
    ).toBeVisible();
    expect(screen.getAllByRole("link", { name: /Карточка акта/u }).at(-1)).toHaveAttribute(
      "href",
      VIEW.cardUrl,
    );
    expect(screen.queryByRole("navigation", { name: "Оглавление" })).toBeNull();
  });

  it("акт утратил силу — дата в предупреждении", async () => {
    server.use(
      act({ ...VIEW, act: item({ status: "repealed", repealedOn: "2025-04-23" }), pending: [] }),
      fragments(),
    );
    renderPage();
    expect(await screen.findByText("Акт утратил силу с 23.04.2025.")).toBeVisible();
  });
});

describe("CHAT-08: «Спросить ассистента об этой статье»", () => {
  afterEach(() => assistantBridge.reset());

  it("вошедшему — кнопка: вопрос об этой статье ложится в поле ассистента, не отправляется", async () => {
    server.use(act(), fragments());
    renderPage({ article: 210 }, true);
    await userEvent.click(
      await screen.findByRole("button", { name: "Спросить ассистента об этой статье" }),
    );
    expect(assistantBridge.getState().openRequest).toBe(1);
    expect(assistantBridge.getState().pendingQuestion).toBe(
      "Объясните простыми словами, что сказано в ст. 210 акта «НК (Особенная часть)».",
    );
  });

  it("гостю — «Войдите, чтобы спросить ассистента» со ссылкой на вход; кнопки вопроса нет", async () => {
    server.use(act(), fragments());
    renderPage({ article: 210 }, false);
    expect(
      await screen.findByRole("link", { name: "Войдите, чтобы спросить ассистента" }),
    ).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "Спросить ассистента об этой статье" })).toBeNull();
  });
});
