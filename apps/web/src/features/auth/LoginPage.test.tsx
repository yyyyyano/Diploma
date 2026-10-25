// AUTH-08: вход — форма на схеме контракта, неверные данные — текст из словаря, успех — кэш очищен и переход на «/».
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
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { LoginPage } from "./LoginPage.tsx";
import type { LoginSearch } from "./model/search.ts";

function renderLogin(search: LoginSearch = {}, setupAvailable = false) {
  server.use(
    http.get("*/api/identity/status", () =>
      HttpResponse.json({ initialized: !setupAvailable, setupAvailable }),
    ),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["прежний", "пользователь"], { email: "old@example.test" });
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/login",
        component: () => <LoginPage search={search} />,
      }),
      createRoute({ getParentRoute: () => root, path: "/", component: () => <p>Стартовый</p> }),
      createRoute({ getParentRoute: () => root, path: "/setup", component: () => <p>Setup</p> }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/login"] }),
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

async function fill(email: string, password: string) {
  await userEvent.type(await screen.findByRole("textbox", { name: "Email" }), email);
  await userEvent.type(screen.getByLabelText("Пароль"), password);
  await userEvent.click(screen.getByRole("button", { name: "Войти" }));
}

describe("AUTH-08: вход", () => {
  it("верные данные — вход, кэш прежних данных очищен, переход на стартовый маршрут", async () => {
    let body: unknown;
    server.use(
      http.post("*/api/identity/sign-in", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ email: "admin@example.test", name: "", role: "admin" });
      }),
    );
    const { queryClient } = renderLogin();
    await fill("admin@example.test", "пароль-администратора");
    expect(await screen.findByText("Стартовый")).toBeInTheDocument();
    expect(body).toEqual({ email: "admin@example.test", password: "пароль-администратора" });
    expect(queryClient.getQueryData(["прежний", "пользователь"])).toBeUndefined();
  });

  it("INVALID_CREDENTIALS — «Неверный email или пароль…» в role=alert, остаёмся на входе", async () => {
    server.use(
      http.post("*/api/identity/sign-in", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "INVALID_CREDENTIALS",
            status: 401,
            message: "INVALID_CREDENTIALS",
            data: { requestId: "req-00000001", params: {} },
          },
          { status: 401 },
        ),
      ),
    );
    renderLogin();
    await fill("admin@example.test", "неверный-пароль");
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный email или пароль");
    expect(screen.getByRole("heading", { level: 1, name: "Вход в Кошт" })).toBeInTheDocument();
  });

  it("не email и пустой пароль — подсказки у полей, запроса нет", async () => {
    renderLogin();
    await userEvent.type(await screen.findByRole("textbox", { name: "Email" }), "не-email");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByText("Введите email, например name@example.by.")).toBeInTheDocument();
    expect(screen.getByText("Введите пароль.")).toBeInTheDocument();
  });

  it("пришли с первого запуска — «Администратор создан»; ссылка «Первый запуск» — только пока он доступен", async () => {
    renderLogin({ created: true }, false);
    expect(await screen.findByRole("status")).toHaveTextContent("Администратор создан");
    expect(screen.queryByRole("link", { name: "Первый запуск" })).not.toBeInTheDocument();
  });

  it("система не инициализирована и вход локальный — ссылка «Первый запуск»", async () => {
    renderLogin({}, true);
    expect(await screen.findByRole("link", { name: "Первый запуск" })).toHaveAttribute(
      "href",
      "/setup",
    );
  });
});
