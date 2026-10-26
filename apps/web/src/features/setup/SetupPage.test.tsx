// AUTH-10, SEC-01: первый запуск — пароль не короче 12 символов, успех — на вход с «Администратор создан»,
// система уже настроена (CONFLICT) — на вход.
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
import { SetupPage } from "./SetupPage.tsx";

function renderSetup() {
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/setup", component: SetupPage }),
      createRoute({
        getParentRoute: () => root,
        path: "/login",
        component: () => <p>Вход</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/setup"] }),
  });
  renderWithProviders(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function submit(email: string, password: string) {
  await userEvent.type(await screen.findByRole("textbox", { name: "Email администратора" }), email);
  await userEvent.type(screen.getByLabelText("Пароль"), password);
  await userEvent.click(screen.getByRole("button", { name: "Создать администратора" }));
}

const conflict = {
  defined: true,
  code: "CONFLICT",
  status: 409,
  message: "CONFLICT",
  data: { requestId: "req-00000001", params: {} },
};

describe("AUTH-10: экран первого запуска", () => {
  it("только на этом компьютере — так и написано; подсказка «Минимум 12 символов»", async () => {
    renderSetup();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Создайте администратора" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Только на этом компьютере · localhost")).toBeInTheDocument();
    expect(screen.getByText("Минимум 12 символов")).toBeInTheDocument();
  });

  it("пароль из 11 символов — подсказка у поля, запроса нет", async () => {
    renderSetup();
    await submit("admin@example.test", "12345678901");
    expect(await screen.findByText("Пароль — не короче 12 символов.")).toBeInTheDocument();
  });

  it("AUTH-05: администратор создан — код восстановления один раз; «Продолжить» только после «сохранил» — на вход", async () => {
    let body: unknown;
    server.use(
      http.post("*/api/identity/setup", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true, recoveryCode: "KQ7M-4XPD-9TJC-2HWR" });
      }),
    );
    const router = renderSetup();
    await submit("admin@example.test", "пароль-администратора");
    expect(
      await screen.findByRole("heading", { name: "Сохраните код восстановления" }),
    ).toBeInTheDocument();
    expect(screen.getByText("KQ7M-4XPD-9TJC-2HWR")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Продолжить" });
    expect(next).toBeDisabled();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Я сохранил(а) код в надёжном месте" }),
    );
    await userEvent.click(next);
    expect(await screen.findByText("Вход")).toBeInTheDocument();
    expect(body).toEqual({ email: "admin@example.test", password: "пароль-администратора" });
    expect(router.state.location.search).toEqual({ created: true });
  });

  it("система уже настроена (CONFLICT) — на вход без пометки", async () => {
    server.use(
      http.post("*/api/identity/setup", () => HttpResponse.json(conflict, { status: 409 })),
    );
    const router = renderSetup();
    await submit("admin@example.test", "пароль-администратора");
    expect(await screen.findByText("Вход")).toBeInTheDocument();
    expect(router.state.location.search).toEqual({});
  });
});
