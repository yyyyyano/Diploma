// AUTH-04, AUTH-05: восстановление доступа — запрос ссылки («Проверьте почту» и ящик), новый пароль по ссылке
// (использованная — LINK_INVALID и «Запросить новую ссылку»), вход с кодом (новый код один раз, «Перейти» — после
// «сохранил»).
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
import type { RecoverySearch } from "./model/recovery-search.ts";
import { RecoveryPage } from "./RecoveryPage.tsx";

const TOKEN = "AbcDEF_ghij-KLMN0123456789abcdefghijklmnopq";

function renderRecovery(search: RecoverySearch) {
  server.use(http.get("*/api/mail/status", () => HttpResponse.json({ mailboxAvailable: true })));
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/recovery",
        component: () => <RecoveryPage search={search} />,
      }),
      createRoute({ getParentRoute: () => root, path: "/", component: () => <p>Стартовый</p> }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/recovery"] }),
  });
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const linkInvalid = () =>
  HttpResponse.json(
    {
      defined: true,
      code: "LINK_INVALID",
      status: 410,
      message: "LINK_INVALID",
      data: { requestId: "req-00000001", params: {} },
    },
    { status: 410 },
  );

describe("AUTH-04: «Забыли пароль?»", () => {
  it("email — «Проверьте почту» с адресом и ссылкой на локальный ящик", async () => {
    let body: unknown;
    server.use(
      http.post("*/api/identity/password-reset/request", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderRecovery({});
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Email аккаунта" }),
      "irina@example.by",
    );
    await userEvent.click(screen.getByRole("button", { name: "Отправить ссылку" }));
    expect(await screen.findByRole("heading", { name: "Проверьте почту" })).toBeInTheDocument();
    expect(screen.getByText(/irina@example\.by/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Открыть локальный почтовый ящик (демо)" }),
    ).toHaveAttribute("href", "/mailbox");
    expect(body).toEqual({ email: "irina@example.by" });
  });

  it("по ссылке — новый пароль сохранён, «Войти»", async () => {
    let body: unknown;
    server.use(
      http.post("*/api/identity/password-reset", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderRecovery({ token: TOKEN });
    await userEvent.type(await screen.findByLabelText("Новый пароль"), "новый-пароль-2026");
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "новый-пароль-2026");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить пароль" }));
    expect(await screen.findByRole("heading", { name: "Пароль изменён" })).toBeInTheDocument();
    expect(body).toEqual({ token: TOKEN, password: "новый-пароль-2026" });
  });

  it("ссылка использована или устарела — текст из словаря и «Запросить новую ссылку»", async () => {
    server.use(http.post("*/api/identity/password-reset", linkInvalid));
    renderRecovery({ token: TOKEN });
    await userEvent.type(await screen.findByLabelText("Новый пароль"), "новый-пароль-2026");
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "новый-пароль-2026");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить пароль" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ссылка уже использована или устарела",
    );
    expect(screen.getByRole("link", { name: "Запросить новую ссылку" })).toHaveAttribute(
      "href",
      "/recovery",
    );
  });

  it("пароли не совпадают — подсказка, запроса нет", async () => {
    renderRecovery({ token: TOKEN });
    await userEvent.type(await screen.findByLabelText("Новый пароль"), "новый-пароль-2026");
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "другой-пароль-2026");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить пароль" }));
    expect(await screen.findByText("Пароли не совпадают.")).toBeInTheDocument();
  });
});

describe("AUTH-05: вход с кодом восстановления", () => {
  it("верный код — новый код показан, «Перейти в Кошт» только после «сохранил»", async () => {
    let body: unknown;
    server.use(
      http.post("*/api/identity/recovery-code/sign-in", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          user: { email: "admin@example.by", name: "", role: "admin", emailVerified: false },
          recoveryCode: "ZZZZ-YYYY-XXXX-WWWW",
        });
      }),
    );
    renderRecovery({ mode: "code" });
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Email аккаунта" }),
      "admin@example.by",
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: /Код восстановления/ }),
      "kq7m-4xpd-9tjc-2hwr",
    );
    await userEvent.type(screen.getByLabelText("Новый пароль"), "новый-пароль-2026");
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "новый-пароль-2026");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить пароль и войти" }));
    expect(await screen.findByText("ZZZZ-YYYY-XXXX-WWWW")).toBeInTheDocument();
    expect(body).toEqual({
      email: "admin@example.by",
      code: "kq7m-4xpd-9tjc-2hwr",
      password: "новый-пароль-2026",
    });
    const go = screen.getByRole("button", { name: "Перейти в Кошт" });
    expect(go).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Я сохранил(а) новый код" }));
    await userEvent.click(go);
    expect(await screen.findByText("Стартовый")).toBeInTheDocument();
  });

  it("неверный код — «Неверный email или пароль…» не говорит, что именно неверно", async () => {
    server.use(
      http.post("*/api/identity/recovery-code/sign-in", () =>
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
    renderRecovery({ mode: "code" });
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Email аккаунта" }),
      "admin@example.by",
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: /Код восстановления/ }),
      "0000-0000-0000-0000",
    );
    await userEvent.type(screen.getByLabelText("Новый пароль"), "новый-пароль-2026");
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "новый-пароль-2026");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить пароль и войти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный email или пароль");
  });
});
