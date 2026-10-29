// ADM-20, ADM-21, ADM-22, OBS-05: «Запросы к ИИ» — плитки показателей, по задачам, кто отвечал, дневные лимиты, период
// в адресе, прайс-лист, ссылка на Langfuse; текстов запросов нет; пусто, загрузка, ошибка.
import { AiPeriod, type AiUsage } from "@kosht/contract";
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
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { AdminAiRequestsPage } from "./AdminAiRequestsPage.tsx";

/** Плитка показателя: подпись лежит в шапке карточки, значение — рядом с шапкой. */
const tile = (title: string) => screen.getByText(title).parentElement?.parentElement;

const usage = (patch: Partial<AiUsage> = {}): AiUsage => ({
  period: "day",
  totals: {
    requests: 412,
    tokens: 1_240_000,
    costMicros: 840_000,
    medianMs: 2100,
    errors: 6,
    errorPermille: 15,
  },
  byTask: [
    { task: "chat", requests: 214, tokens: 900_000 },
    { task: "receipt.extract", requests: 46, tokens: 200_000 },
  ],
  byProvider: [
    { provider: "groq", cloud: true, requests: 292, tokens: 800_000, errors: 4 },
    { provider: "zai", cloud: true, requests: 74, tokens: 300_000, errors: 2 },
    { provider: "llama", cloud: false, requests: 46, tokens: 140_000, errors: 0 },
  ],
  cloudRequests: 366,
  localRequests: 46,
  dailyLimits: [
    {
      id: "groq/openai/gpt-oss-120b",
      provider: "groq",
      requests: { used: 412, limit: 1000 },
      tokens: { used: 128_000, limit: 200_000 },
    },
    {
      id: "zai/glm-4.7-flash",
      provider: "zai",
      requests: { used: 74, limit: null },
      tokens: { used: 300_000, limit: null },
    },
  ],
  prices: [
    {
      id: "groq/openai/gpt-oss-120b",
      provider: "groq",
      model: "openai/gpt-oss-120b",
      inputMicrosPerMillion: 150_000,
      outputMicrosPerMillion: 600_000,
    },
  ],
  langfuseUrl: "http://127.0.0.1:3001",
  ...patch,
});

function renderPage(
  data: AiUsage | ((period: string) => AiUsage) = usage(),
  period: "day" | "week" | "month" = "day",
) {
  const seen: string[] = [];
  server.use(
    http.get("*/api/admin/ai/usage", ({ request }) => {
      const asked = new URL(request.url).searchParams.get("period") ?? "day";
      seen.push(asked);
      return HttpResponse.json(typeof data === "function" ? data(asked) : data);
    }),
  );
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/admin/ai-requests",
    validateSearch: z.object({ period: AiPeriod.catch("day") }),
    component: () => (
      <AdminAiRequestsPage period={(route.useSearch() as { period: AiPeriod }).period} />
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [`/admin/ai-requests?period=${period}`] }),
  });
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { seen };
}

describe("ADM-20: плитки показателей", () => {
  it("запросы, токены, условная стоимость, медиана ответа, доля ошибок — как их считает сервер", async () => {
    renderPage();
    await screen.findByText("412");
    expect(tile("Токенов")).toHaveTextContent("1,24 млн");
    expect(tile("Условная стоимость")).toHaveTextContent("$0,84");
    expect(tile("Медиана ответа")).toHaveTextContent("2,1 с");
    expect(tile("Ошибки")).toHaveTextContent("1,5 %");
    expect(screen.getByText("6 из 412 запросов")).toBeInTheDocument();
  });
});

describe("ADM-20: по задачам и кто отвечал", () => {
  it("задачи названы словами, у полос — подписи для чтения с экрана", async () => {
    renderPage();
    const card = await screen.findByRole("region", { name: "По задачам" });
    expect(within(card).getByText("Чат и агент")).toBeInTheDocument();
    expect(within(card).getByText("Чеки")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar", { name: "Чат и агент: 214" })).toBeInTheDocument();
  });

  it("облачные и локальные в процентах, провайдеры по именам", async () => {
    renderPage();
    const card = await screen.findByRole("region", { name: "Кто отвечал" });
    expect(within(card).getByText(/Облачные модели — 89 %, локальные — 11 %/)).toBeInTheDocument();
    expect(within(card).getByText("Groq")).toBeInTheDocument();
    expect(within(card).getByText("Локальная модель")).toBeInTheDocument();
  });

  it("дневные лимиты: «412 из 1000»; лимит не опубликован — об этом и сказано", async () => {
    renderPage();
    const card = await screen.findByRole("region", { name: "Кто отвечал" });
    expect(within(card).getByText("412 из 1 000")).toBeInTheDocument();
    expect(within(card).getByText("128 тыс. из 200 тыс.")).toBeInTheDocument();
    expect(within(card).getAllByText(/лимит тарифа не опубликован/)).toHaveLength(2);
  });
});

describe("ADM-22, OBS-05: Langfuse и тексты", () => {
  it("текстов нет — сказано прямо; подробные трассы — ссылкой в Langfuse", async () => {
    renderPage();
    expect(
      await screen.findByText(/Текст запросов и ответов здесь не хранится/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Подробные трассы — в Langfuse" })).toHaveAttribute(
      "href",
      "http://127.0.0.1:3001",
    );
  });

  it("Langfuse выключен — ссылки нет, есть пояснение", async () => {
    renderPage(usage({ langfuseUrl: null }));
    expect(await screen.findByText(/Langfuse выключен/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Подробные трассы — в Langfuse" })).toBeNull();
  });
});

describe("период — в адресе", () => {
  it("«24 часа» выбран; «7 дней» — ссылка с period=week, запрос идёт за неделю", async () => {
    const { seen } = renderPage((period) => usage({ period: period as AiUsage["period"] }));
    await screen.findByText("412");
    expect(screen.getByRole("link", { name: "24 часа" })).toHaveAttribute("aria-current", "page");
    const week = screen.getByRole("link", { name: "7 дней" });
    expect(week).toHaveAttribute("href", expect.stringContaining("period=week"));
    await userEvent.click(week);
    await screen.findByRole("link", { name: "7 дней", current: "page" });
    expect(seen).toContain("week");
  });
});

describe("ADM-21: прайс-лист", () => {
  it("цена в долларах уходит микродолларами, стоимость за период обновляется ответом сервера", async () => {
    const sent: unknown[] = [];
    renderPage();
    server.use(
      http.post("*/api/admin/ai/price", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(usage({ totals: { ...usage().totals, costMicros: 1_500_000 } }));
      }),
    );
    await screen.findByText("412");
    await userEvent.click(screen.getByRole("button", { name: "Прайс-лист" }));
    const dialog = await screen.findByRole("dialog", { name: "Прайс-лист для условной стоимости" });
    const input = within(dialog).getByLabelText("Цена входа Groq · openai/gpt-oss-120b");
    expect(input).toHaveValue("0,15");
    await userEvent.clear(input);
    await userEvent.type(input, "0,59");
    await userEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(sent).toEqual([
      {
        id: "groq/openai/gpt-oss-120b",
        inputMicrosPerMillion: 590_000,
        outputMicrosPerMillion: 600_000,
      },
    ]);
    expect(
      await within(dialog).findByText("Цены groq/openai/gpt-oss-120b сохранены."),
    ).toBeInTheDocument();
    expect(tile("Условная стоимость")).toHaveTextContent("$1,50");
  });

  it("не число в цене — «Сохранить» недоступно", async () => {
    renderPage();
    await screen.findByText("412");
    await userEvent.click(screen.getByRole("button", { name: "Прайс-лист" }));
    const dialog = await screen.findByRole("dialog", { name: "Прайс-лист для условной стоимости" });
    const input = within(dialog).getByLabelText("Цена выхода Groq · openai/gpt-oss-120b");
    await userEvent.clear(input);
    await userEvent.type(input, "много");
    expect(within(dialog).getByRole("button", { name: "Сохранить" })).toBeDisabled();
  });
});

describe("DES-16: пусто и ошибка", () => {
  it("за период запросов не было — об этом и сказано, нулей без пояснения нет", async () => {
    renderPage(
      usage({
        totals: {
          requests: 0,
          tokens: 0,
          costMicros: 0,
          medianMs: null,
          errors: 0,
          errorPermille: 0,
        },
        byTask: [],
        byProvider: [],
        cloudRequests: 0,
        localRequests: 0,
        dailyLimits: [],
      }),
    );
    expect(await screen.findAllByText("За выбранный период запросов не было.")).toHaveLength(2);
    expect(tile("Медиана ответа")).toHaveTextContent("—");
  });

  it("ошибка загрузки — понятный текст", async () => {
    server.use(http.get("*/api/admin/ai/usage", () => HttpResponse.error()));
    const root = createRootRoute();
    const route = createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <AdminAiRequestsPage period="day" />,
    });
    renderWithProviders(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider
          router={createRouter({
            routeTree: root.addChildren([route]),
            history: createMemoryHistory(),
          })}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить запросы к ИИ");
  });
});
