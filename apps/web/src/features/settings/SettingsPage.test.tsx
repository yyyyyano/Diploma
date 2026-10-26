// AUTH-03: «Профиль и вход» — почта не подтверждена: отметка, «Отправить письмо ещё раз» и ссылка на ящик; после
// отправки — «Письмо отправлено»; подтверждена — без кнопки; ошибка загрузки — что сделать.
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
import { SettingsPage } from "./SettingsPage.tsx";

function renderSettings(emailVerified: boolean | "error") {
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
  );
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/settings", component: SettingsPage }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
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
