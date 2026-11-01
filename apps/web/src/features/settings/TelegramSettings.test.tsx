// TG-02, PRIV-08: вкладка «Telegram». Нет бота — кнопка неактивна; согласие отмечено — «Подключить» шлёт версию текста и ждёт
// «Старт»; подключён — «Telegram: подключён ✓» и отключение с вопросом.
import { CONSENT_VERSIONS } from "@kosht/i18n";
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
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { SettingsSearch } from "./model/search.ts";
import { SettingsPage } from "./SettingsPage.tsx";

function renderTab(tab: "telegram") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const settingsRoute = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    validateSearch: SettingsSearch,
    component: () => <SettingsPage search={settingsRoute.useSearch()} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([
      settingsRoute,
      createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Вход</p> }),
      createRoute({
        getParentRoute: () => root,
        path: "/policy",
        component: () => <p>Политика</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [`/settings?tab=${tab}`] }),
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

const status = (extra: Record<string, unknown> = {}) => ({
  configured: true,
  botName: "kosht_bot",
  linked: null,
  pending: null,
  ...extra,
});

describe("TG-02, PRIV-08: вкладка «Telegram»", () => {
  it("бот не настроен — кнопка неактивна и объяснено почему", async () => {
    server.use(
      http.get("*/api/telegram", () =>
        HttpResponse.json(status({ configured: false, botName: null })),
      ),
    );
    renderTab("telegram");
    expect(await screen.findByText(/Бот не настроен/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Подключить Telegram" })).toBeDisabled();
  });

  it("«Подключить» неактивна до согласия; с согласием на сервер уходит версия текста, дальше — «Ожидаю нажатия «Старт»»", async () => {
    const sent: unknown[] = [];
    let pending = false;
    server.use(
      http.get("*/api/telegram", () =>
        HttpResponse.json(
          status(pending ? { pending: { expiresAt: "2026-11-01T12:10:00.000Z" } } : {}),
        ),
      ),
      http.post("*/api/telegram/link", async ({ request }) => {
        sent.push(await request.json());
        pending = true;
        return HttpResponse.json({
          url: "https://t.me/kosht_bot?start=abc",
          expiresAt: "2026-11-01T12:10:00.000Z",
        });
      }),
    );
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderTab("telegram");
    const connect = await screen.findByRole("button", { name: "Подключить Telegram" });
    expect(connect).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(connect).toBeEnabled();
    await userEvent.click(connect);
    expect(sent).toEqual([{ version: CONSENT_VERSIONS.telegram }]);
    expect(await screen.findByText("Ожидаю нажатия «Старт» в боте…")).toBeInTheDocument();
    expect(open).toHaveBeenCalledWith("https://t.me/kosht_bot?start=abc", "_blank", "noopener");
    open.mockRestore();
  });

  it("подключён — «Telegram: подключён ✓ @имя»; «Отключить» спрашивает и отключает", async () => {
    let linked = true;
    let unlinked = 0;
    server.use(
      http.get("*/api/telegram", () =>
        HttpResponse.json(
          status(
            linked ? { linked: { since: "2026-10-21T09:00:00.000Z", username: "irina_k" } } : {},
          ),
        ),
      ),
      http.post("*/api/telegram/unlink", () => {
        unlinked += 1;
        linked = false;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderTab("telegram");
    expect(await screen.findByText(/Telegram: подключён ✓ @irina_k/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Отключить" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/согласие на передачу данных через Telegram будет отозвано/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Отключить" }));
    expect(await screen.findByRole("button", { name: "Подключить Telegram" })).toBeInTheDocument();
    expect(unlinked).toBe(1);
  });
});
