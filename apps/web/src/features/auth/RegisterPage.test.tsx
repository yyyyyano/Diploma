// AUTH-01…03, PRIV-01/02, SEC-01: регистрация — кнопка неактивна, пока нет согласия на ПД и пароля по требованиям,
// в запросе — версии текстов согласий и выбор облака; успех — «Аккаунт создан» и ссылка на ящик; ошибки — из словаря.
import { CONSENT_VERSIONS } from "@kosht/i18n";
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
import { RegisterPage } from "./RegisterPage.tsx";

function renderRegister(mailboxAvailable = true) {
  server.use(http.get("*/api/mail/status", () => HttpResponse.json({ mailboxAvailable })));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["прежний", "пользователь"], { email: "old@example.test" });
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/register", component: RegisterPage }),
      createRoute({ getParentRoute: () => root, path: "/", component: () => <p>Стартовый</p> }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/register"] }),
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

async function fillForm(password = "кошт2026весна") {
  await userEvent.type(await screen.findByRole("textbox", { name: /Email/ }), "irina@example.by");
  await userEvent.type(screen.getByLabelText("Пароль", { exact: true }), password);
  await userEvent.type(screen.getByLabelText("Повторите пароль"), password);
}

const submit = () => screen.getByRole("button", { name: "Создать аккаунт" });

describe("AUTH-02, PRIV-01: согласие на обработку ПД обязательно", () => {
  it("без галочки согласия кнопка неактивна и сказано, чего не хватает", async () => {
    renderRegister();
    await fillForm();
    expect(submit()).toBeDisabled();
    expect(
      screen.getByText(/Чтобы продолжить: отметьте согласие на обработку данных/),
    ).toBeInTheDocument();
  });

  it("короткий пароль — требование «От 12 символов» не выполнено, кнопка неактивна", async () => {
    renderRegister();
    await fillForm("кошт2026");
    await userEvent.click(screen.getByRole("checkbox", { name: /согласен/ }));
    expect(screen.getByText("От 12 символов").closest("li")).toHaveAttribute("data-done", "false");
    expect(submit()).toBeDisabled();
  });

  it("пароли не совпадают — «Пароли не совпадают.»", async () => {
    renderRegister();
    await userEvent.type(await screen.findByLabelText("Пароль", { exact: true }), "кошт2026весна");
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "кошт2026лето");
    expect(screen.getByText("Пароли не совпадают.")).toBeInTheDocument();
  });

  it("пересказ «Что именно обрабатываем» раскрывается по кнопке", async () => {
    renderRegister();
    const toggle = await screen.findByRole("button", { name: "Что именно обрабатываем — коротко" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Сколько храним")).toBeVisible();
  });
});

describe("AUTH-01, PRIV-02: создание аккаунта", () => {
  it("с облачным согласием: в запросе версии текстов; успех — «Аккаунт создан», кэш очищен, ссылка на ящик", async () => {
    let body: unknown;
    server.use(
      http.post("*/api/identity/register", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          email: "irina@example.by",
          name: "",
          role: "user",
          emailVerified: false,
        });
      }),
    );
    const { queryClient } = renderRegister();
    await fillForm();
    await userEvent.click(screen.getByRole("checkbox", { name: /согласен/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /облачные ИИ-модели/ }));
    expect(
      screen.getByText("Облачный режим: ответы быстрее, текст маскируется."),
    ).toBeInTheDocument();
    await userEvent.click(submit());
    expect(await screen.findByRole("heading", { name: "Аккаунт создан" })).toBeInTheDocument();
    expect(body).toEqual({
      email: "irina@example.by",
      password: "кошт2026весна",
      consents: {
        personalData: { accepted: true, version: CONSENT_VERSIONS.personalData },
        cloud: { accepted: true, version: CONSENT_VERSIONS.cloud },
      },
    });
    expect(queryClient.getQueryData(["прежний", "пользователь"])).toBeUndefined();
    expect(
      await screen.findByRole("link", { name: "Открыть локальный почтовый ящик (демо)" }),
    ).toHaveAttribute("href", "/mailbox");
    await userEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(await screen.findByText("Стартовый")).toBeInTheDocument();
  });

  it("EMAIL_TAKEN — текст «уже зарегистрирован» в role=alert", async () => {
    server.use(
      http.post("*/api/identity/register", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "EMAIL_TAKEN",
            status: 409,
            message: "EMAIL_TAKEN",
            data: { requestId: "req-00000001", params: {} },
          },
          { status: 409 },
        ),
      ),
    );
    renderRegister(false);
    await fillForm();
    await userEvent.click(screen.getByRole("checkbox", { name: /согласен/ }));
    await userEvent.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("Этот email уже зарегистрирован");
  });

  it("RATE_LIMITED — «Попробуйте через 42 мин.»", async () => {
    server.use(
      http.post("*/api/identity/register", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "RATE_LIMITED",
            status: 429,
            message: "RATE_LIMITED",
            data: {
              requestId: "req-00000001",
              params: { retryAfterSeconds: 2500, retryAfterMinutes: 42 },
            },
          },
          { status: 429 },
        ),
      ),
    );
    renderRegister(false);
    await fillForm();
    await userEvent.click(screen.getByRole("checkbox", { name: /согласен/ }));
    await userEvent.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("Попробуйте через 42 мин.");
  });
});
