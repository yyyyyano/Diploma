// Роутер сайта: охрана раздела по роли, каркас с выходом, граница ошибок (DES-16) — на настоящем дереве маршрутов.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { SessionSource, SessionUser } from "../lib/session.ts";
import { server } from "../test/msw.ts";
import { renderWithProviders } from "../test/render.tsx";
import { ErrorScreen } from "./ErrorScreen.tsx";
import { createAppRouter } from "./router.tsx";

const admin: SessionUser = { name: "Ирина Ковальчук", email: "irina@example.test", role: "admin" };

/** Сессия, которую можно завершить: после signOut — гость. */
function sessionOf(user: SessionUser | undefined) {
  let current = user;
  const signOut = vi.fn<() => Promise<void>>(() => {
    current = undefined;
    return Promise.resolve();
  });
  const session: SessionSource = { current: () => Promise.resolve(current), signOut };
  return { session, signOut };
}

function renderApp(path: string, session: SessionSource) {
  // Поток событий каркаса: без сессии сервер отвечает UNAUTHORIZED — поток не переподключается.
  server.use(
    http.get("*/api/events/stream", () =>
      HttpResponse.json(
        {
          defined: true,
          code: "UNAUTHORIZED",
          status: 401,
          message: "UNAUTHORIZED",
          data: { requestId: "req-00000001", params: {} },
        },
        { status: 401 },
      ),
    ),
  );
  const queryClient = new QueryClient();
  const router = createAppRouter({
    queryClient,
    session,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

describe("раздел «Администрирование» — проверка роли в beforeLoad", () => {
  it("администратор видит раздел в каркасе", async () => {
    renderApp("/admin", sessionOf(admin).session);
    expect(await screen.findByRole("complementary", { name: "Основное меню" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Такой страницы нет" })).not.toBeInTheDocument();
  });

  it("пользователь без роли admin получает «Такой страницы нет»", async () => {
    renderApp("/admin", sessionOf({ ...admin, role: "user" }).session);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Такой страницы нет" }),
    ).toBeInTheDocument();
  });

  it("неизвестный адрес — «Такой страницы нет»", async () => {
    renderApp("/no-such-page", sessionOf(admin).session);
    expect(await screen.findByRole("heading", { name: "Такой страницы нет" })).toBeInTheDocument();
  });
});

describe("каркас: пользователь и выход", () => {
  it("«Выйти» завершает сессию, чистит кэш и ведёт на вход (AUTH-08)", async () => {
    server.use(
      http.get("*/api/identity/status", () =>
        HttpResponse.json({ initialized: true, setupAvailable: false }),
      ),
    );
    const { session, signOut } = sessionOf(admin);
    const { queryClient, router } = renderApp("/admin", session);
    queryClient.setQueryData(["accounts", "list"], [{ name: "Наличные" }]);
    await userEvent.click(await screen.findByRole("button", { name: "Выйти" }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "Вход в Кошт" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(queryClient.getQueryData(["accounts", "list"])).toBeUndefined();
  });

  it("гость в разделе пользователя — на вход", async () => {
    server.use(
      http.get("*/api/identity/status", () =>
        HttpResponse.json({ initialized: true, setupAvailable: false }),
      ),
    );
    const { router } = renderApp("/accounts", sessionOf(undefined).session);
    expect(await screen.findByRole("heading", { name: "Вход в Кошт" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });
});

describe("AUTH-10, NFR-24: стартовый маршрут «/»", () => {
  function status(setupAvailable: boolean) {
    server.use(
      http.get("*/api/identity/status", () =>
        HttpResponse.json({ initialized: !setupAvailable, setupAvailable }),
      ),
    );
  }

  it("гость, система не инициализирована, вход локальный — первый запуск", async () => {
    status(true);
    const { router } = renderApp("/", sessionOf(undefined).session);
    expect(
      await screen.findByRole("heading", { name: "Создайте администратора" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/setup");
  });

  it("гость, первый запуск недоступен (пройден или вход сетевой) — вход; /setup тоже ведёт на вход", async () => {
    status(false);
    const { router } = renderApp("/", sessionOf(undefined).session);
    expect(await screen.findByRole("heading", { name: "Вход в Кошт" })).toBeInTheDocument();
    await router.navigate({ to: "/setup" });
    expect(await screen.findByRole("heading", { name: "Вход в Кошт" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("AUTH-07: вошедший впервые — на анкету на 1 минуту", async () => {
    server.use(
      http.get("*/api/profile/onboarding", () => HttpResponse.json({ status: "pending" })),
    );
    const { router } = renderApp("/", sessionOf(admin).session);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Как вы зарабатываете?" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/onboarding");
  });

  it("AUTH-07: анкету прошли или пропустили — /onboarding ведёт дальше, в «Счета»", async () => {
    server.use(
      http.get("*/api/profile/onboarding", () => HttpResponse.json({ status: "done" })),
      http.get("*/api/accounts", () => HttpResponse.json({ items: [] })),
    );
    const { router } = renderApp("/onboarding", sessionOf(admin).session);
    expect(await screen.findByRole("heading", { level: 1, name: "Счета" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/accounts");
  });

  it("вошедший — в раздел «Счета»", async () => {
    server.use(
      http.get("*/api/profile/onboarding", () => HttpResponse.json({ status: "done" })),
      http.get("*/api/accounts", () => HttpResponse.json({ items: [] })),
    );
    const { router } = renderApp("/", sessionOf(admin).session);
    expect(await screen.findByRole("heading", { level: 1, name: "Счета" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/accounts");
  });
});

describe("DES-16: граница ошибок", () => {
  it("страница упала — «Что-то пошло не так», повтор загружает её снова", async () => {
    let failures = 1;
    const root = createRootRoute();
    const page = createRoute({
      getParentRoute: () => root,
      path: "/",
      loader: () => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("сбой загрузки");
        }
      },
      component: () => <p>Страница открылась</p>,
    });
    const router = createRouter({
      routeTree: root.addChildren([page]),
      history: createMemoryHistory(),
      defaultErrorComponent: ErrorScreen,
    });
    renderWithProviders(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "Что-то пошло не так" })).toBeInTheDocument();
    expect(screen.getByText(/Ваши данные целы/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Попробовать ещё раз" }));
    expect(await screen.findByText("Страница открылась")).toBeInTheDocument();
  });
});
