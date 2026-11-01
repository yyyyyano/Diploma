// CHAT-08: плавающая кнопка «Спросить ассистента» на любой странице — панель справа с «Вижу: Главная · Сентябрь 2026»,
// агент получает период страницы; на телефоне — страница чата; вопрос из другого места сайта ложится в поле ввода.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantBridge } from "../../lib/assistant-bridge.ts";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { FloatingAssistant } from "./FloatingAssistant.tsx";

/** Панель — ленивый чанк: под нагрузкой полного прогона его загрузка дольше секунды по умолчанию. */
const SLOW = { timeout: 5000 };
const D1 = "0190f0a0-0000-7000-8000-0000000000d1";
const RUN = "0190f0a0-0000-7000-8000-0000000000a1";

function sse(chunks: readonly unknown[]): string {
  return `${chunks.map((chunk) => `event: message\ndata: ${JSON.stringify(chunk)}\n\n`).join("")}event: done\n\n`;
}

function backend() {
  const sent: unknown[] = [];
  server.use(
    http.get("*/api/chat/conversations", () => HttpResponse.json({ items: [] })),
    http.get("*/api/privacy", () =>
      HttpResponse.json({ cloud: { granted: true, since: null, outdated: false }, history: [] }),
    ),
    http.get("*/api/llm/models", () => HttpResponse.json({ items: [], selected: null })),
    http.post("*/api/chat/send", async ({ request }) => {
      sent.push(await request.json());
      return new HttpResponse(
        sse([
          { type: "start", messageId: "m1", messageMetadata: { runId: RUN, conversationId: D1 } },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "В сентябре на такси ушло 112,40 BYN." },
          { type: "text-end", id: "t1" },
          { type: "finish" },
        ]),
        { headers: { "content-type": "text/event-stream" } },
      );
    }),
  );
  return sent;
}

function phone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  assistantBridge.reset();
});

function renderAt(path: string) {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <FloatingAssistant />
      </>
    ),
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/home",
    staticData: { page: "dashboard" },
    component: () => <h1>Главная</h1>,
  });
  const chat = createRoute({
    getParentRoute: () => root,
    path: "/assistant",
    staticData: { page: "assistant" },
    component: () => <h1>Страница чата</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, chat]),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: {},
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

describe("CHAT-08: кнопка и панель", () => {
  it("на главной за сентябрь: кнопка открывает панель «Вижу: Главная · Сентябрь 2026»; вопрос уходит с периодом", async () => {
    const sent = backend();
    renderAt("/home?from=2026-09-01&to=2026-09-30");
    await userEvent.click(await screen.findByRole("button", { name: "Спросить ассистента" }));
    const panel = await screen.findByRole("dialog", {}, SLOW);
    expect(await within(panel).findByText("Вижу: Главная · Сентябрь 2026")).toBeInTheDocument();
    await userEvent.type(
      await within(panel).findByRole("textbox", { name: "Вопрос ассистенту" }),
      "Почему так много на такси?",
    );
    await userEvent.click(within(panel).getByRole("button", { name: "Отправить" }));
    expect(
      await within(panel).findByText("В сентябре на такси ушло 112,40 BYN."),
    ).toBeInTheDocument();
    expect(sent[0]).toMatchObject({
      text: "Почему так много на такси?",
      page: { route: "/home", params: { from: "2026-09-01", to: "2026-09-30" } },
    });
  });

  it("быстрые вопросы панели — подсказки; нажатие отправляет вопрос", async () => {
    const sent = backend();
    renderAt("/home");
    await userEvent.click(await screen.findByRole("button", { name: "Спросить ассистента" }));
    const panel = await screen.findByRole("dialog", {}, SLOW);
    await userEvent.click(
      await within(panel).findByRole("button", { name: "Почему так много на такси?" }),
    );
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it("на странице чата кнопки нет — чат уже перед глазами", async () => {
    backend();
    renderAt("/assistant");
    await screen.findByRole("heading", { name: "Страница чата" });
    expect(screen.queryByRole("button", { name: "Спросить ассистента" })).toBeNull();
  });

  it("на телефоне панели нет: кнопка открывает страницу чата", async () => {
    backend();
    phone(true);
    const router = renderAt("/home");
    await userEvent.click(await screen.findByRole("button", { name: "Спросить ассистента" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/assistant"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("просьба из моста открывает панель, а вопрос лежит в поле ввода — не отправлен", async () => {
    const sent = backend();
    renderAt("/home");
    await screen.findByRole("button", { name: "Спросить ассистента" });
    act(() => assistantBridge.open("Что сказано в ст. 210 НК простыми словами?"));
    const panel = await screen.findByRole("dialog", {}, SLOW);
    const field = await within(panel).findByRole("textbox", { name: "Вопрос ассистенту" });
    await waitFor(() => expect(field).toHaveValue("Что сказано в ст. 210 НК простыми словами?"));
    expect(sent).toHaveLength(0);
  });
});
