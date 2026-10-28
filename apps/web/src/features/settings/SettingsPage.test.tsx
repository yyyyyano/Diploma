// AUTH-03, AUTH-05, AUTH-08: «Профиль и вход» — почта (отметка, «Отправить письмо ещё раз», ящик), смена пароля
// (неверный текущий — текст из словаря), код восстановления (показан один раз), выход (кэш очищен, на вход).
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
import { SettingsSearch } from "./model/search.ts";
import { SettingsPage } from "./SettingsPage.tsx";

function renderSettings(
  emailVerified: boolean | "error",
  codeCreatedAt: string | null = null,
  entry = "/settings",
) {
  server.use(
    http.get("*/api/identity/me", () =>
      emailVerified === "error"
        ? HttpResponse.json(
            {
              defined: true,
              code: "INTERNAL",
              status: 500,
              message: "INTERNAL",
              data: { requestId: "req-00000001", params: {} },
            },
            { status: 500 },
          )
        : HttpResponse.json({ email: "irina@example.by", name: "", role: "user", emailVerified }),
    ),
    http.get("*/api/mail/status", () => HttpResponse.json({ mailboxAvailable: true })),
    http.get("*/api/identity/recovery-code", () => HttpResponse.json({ createdAt: codeCreatedAt })),
    http.get("*/api/identity/admin-reset", () => HttpResponse.json({ at: null })),
  );
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
    ]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("AUTH-03: почта в настройках", () => {
  it("не подтверждена — отметка, пояснение, «ещё раз» отправляет письмо; ссылка на локальный ящик", async () => {
    let sent = 0;
    server.use(
      http.post("*/api/identity/resend-verification", () => {
        sent += 1;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderSettings(false);
    expect(await screen.findByText("Не подтверждён")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть локальный ящик (демо)" })).toHaveAttribute(
      "href",
      "/mailbox",
    );
    await userEvent.click(screen.getByRole("button", { name: "Отправить письмо ещё раз" }));
    expect(
      await screen.findByText("Письмо отправлено — откройте ссылку из него."),
    ).toBeInTheDocument();
    expect(sent).toBe(1);
  });

  it("подтверждена — «Подтверждён», кнопки «ещё раз» нет", async () => {
    renderSettings(true);
    expect(await screen.findByText("Подтверждён")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отправить письмо ещё раз" })).toBeNull();
  });

  it("частота — «Попробуйте через N мин.» в role=alert", async () => {
    server.use(
      http.post("*/api/identity/resend-verification", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "RATE_LIMITED",
            status: 429,
            message: "RATE_LIMITED",
            data: { requestId: "req-00000001", params: { retryAfterMinutes: 17 } },
          },
          { status: 429 },
        ),
      ),
    );
    renderSettings(false);
    await userEvent.click(await screen.findByRole("button", { name: "Отправить письмо ещё раз" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Попробуйте через 17 мин.");
  });

  it("профиль не загрузился — ошибка и «Попробовать ещё раз»", async () => {
    renderSettings("error");
    expect(
      await screen.findByRole("heading", { name: "Настройки не открылись" }),
    ).toBeInTheDocument();
  });
});

describe("AUTH-08: смена пароля и выход", () => {
  it("верный текущий пароль — «Пароль изменён», в запросе без повтора", async () => {
    let body: unknown;
    server.use(
      http.post("*/api/identity/password", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderSettings(true);
    await userEvent.type(await screen.findByLabelText("Текущий пароль"), "старый-пароль-2026");
    await userEvent.type(screen.getByLabelText("Новый пароль"), "новый-пароль-2026");
    await userEvent.type(screen.getByLabelText("Повторите новый пароль"), "новый-пароль-2026");
    await userEvent.click(screen.getByRole("button", { name: "Сменить пароль" }));
    expect(await screen.findByText("Пароль изменён. Другие сеансы завершены.")).toBeInTheDocument();
    expect(body).toEqual({
      currentPassword: "старый-пароль-2026",
      newPassword: "новый-пароль-2026",
    });
  });

  it("неверный текущий пароль — INVALID_CREDENTIALS из словаря в role=alert", async () => {
    server.use(
      http.post("*/api/identity/password", () =>
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
    renderSettings(true);
    await userEvent.type(await screen.findByLabelText("Текущий пароль"), "не-тот-пароль");
    await userEvent.type(screen.getByLabelText("Новый пароль"), "новый-пароль-2026");
    await userEvent.type(screen.getByLabelText("Повторите новый пароль"), "новый-пароль-2026");
    await userEvent.click(screen.getByRole("button", { name: "Сменить пароль" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный email или пароль");
  });

  it("«Выйти из аккаунта» — сессия завершена, переход на вход", async () => {
    let signedOut = false;
    server.use(
      http.post("*/api/identity/sign-out", () => {
        signedOut = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderSettings(true);
    await userEvent.click(await screen.findByRole("button", { name: "Выйти из аккаунта" }));
    expect(await screen.findByText("Вход")).toBeInTheDocument();
    expect(signedOut).toBe(true);
  });
});

describe("AUTH-05, R37: «Пароль был сброшен администратором»", () => {
  it("отметка есть — дата и пояснение; «Понятно» гасит её на сервере и прячет плашку", async () => {
    let at: string | null = "2026-10-21T07:14:00.000Z";
    let acknowledged = 0;
    renderSettings(true);
    server.use(
      http.get("*/api/identity/admin-reset", () => HttpResponse.json({ at })),
      http.post("*/api/identity/admin-reset/ack", () => {
        acknowledged += 1;
        at = null;
        return HttpResponse.json({ ok: true });
      }),
    );
    expect(
      await screen.findByText("Пароль был сброшен администратором 21.10.2026"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Понятно" }));
    await expect
      .poll(() => screen.queryByText("Пароль был сброшен администратором 21.10.2026"))
      .toBeNull();
    expect(acknowledged).toBe(1);
  });

  it("отметки нет — плашки нет", async () => {
    renderSettings(true);
    expect(await screen.findByText("Подтверждён")).toBeInTheDocument();
    expect(screen.queryByText(/сброшен администратором/)).toBeNull();
  });
});

describe("AUTH-05: код восстановления в настройках", () => {
  it("кода нет — «Создать» показывает код один раз; «Я сохранил(а) код» прячет его", async () => {
    server.use(
      http.post("*/api/identity/recovery-code", () =>
        HttpResponse.json({
          recoveryCode: "KQ7M-4XPD-9TJC-2HWR",
          createdAt: "2026-10-26T09:00:00.000Z",
        }),
      ),
    );
    renderSettings(true);
    expect(await screen.findByText("Кода пока нет")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Создать код восстановления" }));
    expect(await screen.findByText("KQ7M-4XPD-9TJC-2HWR")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Я сохранил(а) код" }));
    expect(screen.queryByText("KQ7M-4XPD-9TJC-2HWR")).toBeNull();
  });

  it("код уже есть — «Код создан 26.10.2026» и «Создать новый»", async () => {
    renderSettings(true, "2026-10-26T09:00:00.000Z");
    expect(await screen.findByText("Код создан 26.10.2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Создать новый" })).toBeInTheDocument();
  });
});

describe("NOTIF-04: вкладка «Уведомления»", () => {
  it("матрица всех видов: сайт — переключатель сохраняется сразу, Telegram — неактивен до подключения", async () => {
    let saved: unknown;
    server.use(
      http.get("*/api/notifications/preferences", () =>
        HttpResponse.json({
          items: [
            { kind: "limit", web: true, telegram: true },
            { kind: "goal", web: false, telegram: true },
            { kind: "deduction", web: true, telegram: true },
            { kind: "receipt-match", web: true, telegram: true },
            { kind: "receipt-review", web: true, telegram: true },
            { kind: "statement-imported", web: true, telegram: true },
            { kind: "calendar-reminder", web: true, telegram: true },
            { kind: "weekly-summary", web: true, telegram: true },
            { kind: "recurring-missed", web: true, telegram: true },
          ],
        }),
      ),
      http.post("*/api/notifications/preferences", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderSettings(true, null, "/settings?tab=notifications");
    expect(
      await screen.findByRole("heading", { name: "Что и куда присылать" }),
    ).toBeInTheDocument();
    // Заголовок и 10 видов NOTIF-02 (десятый — «архив «Мои данные» готов», R47).
    expect(await screen.findAllByRole("row")).toHaveLength(11);
    const goalWeb = screen.getByRole("switch", { name: "Прогресс цели — На сайте" });
    expect(goalWeb).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Лимит: 80% и 100% — В Telegram" })).toBeDisabled();
    await userEvent.click(screen.getByRole("switch", { name: "Лимит: 80% и 100% — На сайте" }));
    await expect.poll(() => saved).toEqual({ kind: "limit", channel: "web", enabled: false });
  });
});
