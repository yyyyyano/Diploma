// AUTH-06: локальный ящик — загрузка, пусто, выключен (почта настроена), ошибка (сетевой вход — NOT_FOUND) и письма:
// первое открыто, остальные — с отметкой «не прочитано», открытие письма показывает кнопку со ссылкой и ссылку целиком.
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
import { MailboxPage } from "./MailboxPage.tsx";

const verify = {
  id: "0199f0a0-0000-7000-8000-000000000002",
  to: "irina@example.by",
  subject: "Подтвердите адрес электронной почты",
  preview: "Подтвердите адрес — так по почте можно будет восстановить пароль.",
  title: "Подтвердите ваш адрес",
  paragraphs: ["Здравствуйте!", "Пользоваться Коштом можно и до подтверждения."],
  action: { label: "Подтвердить адрес", url: "http://127.0.0.1:8140/verify-email?token=abc" },
  note: { kind: "info", text: "Ссылка действует 24 ч." },
  sentAt: "2026-10-26T07:12:00.000Z",
};
const older = {
  ...verify,
  id: "0199f0a0-0000-7000-8000-000000000001",
  to: "petr@example.by",
  subject: "Сброс пароля",
  action: { label: "Задать новый пароль", url: "http://127.0.0.1:8140/recovery?token=xyz" },
  note: { kind: "warn", text: "Ссылка действует 1 ч." },
};

function renderMailbox(respond: () => Response) {
  server.use(http.get("*/api/mail/mailbox", respond));
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/mailbox", component: MailboxPage }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/mailbox"] }),
  });
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("AUTH-06: локальный почтовый ящик", () => {
  it("предупреждение «Только для демо и разработки» видно всегда", async () => {
    renderMailbox(() => HttpResponse.json({ enabled: true, messages: [] }));
    expect(await screen.findByText("Только для демо и разработки.")).toBeInTheDocument();
  });

  it("писем нет — пустое состояние с подсказкой", async () => {
    renderMailbox(() => HttpResponse.json({ enabled: true, messages: [] }));
    expect(await screen.findByRole("heading", { name: "Писем пока нет" })).toBeInTheDocument();
  });

  it("почта настроена — ящик выключен, так и сказано", async () => {
    renderMailbox(() => HttpResponse.json({ enabled: false, messages: [] }));
    expect(await screen.findByRole("heading", { name: "Почта настроена" })).toBeInTheDocument();
  });

  it("сетевой вход (NOT_FOUND) — ошибка «только на этом компьютере» и «Попробовать ещё раз»", async () => {
    renderMailbox(() =>
      HttpResponse.json(
        {
          defined: true,
          code: "NOT_FOUND",
          status: 404,
          message: "NOT_FOUND",
          data: { requestId: "req-00000001", params: {} },
        },
        { status: 404 },
      ),
    );
    expect(await screen.findByRole("heading", { name: "Ящик не открылся" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Попробовать ещё раз" })).toBeInTheDocument();
  });

  it("письма: новое открыто, второе — непрочитано; открытие показывает кнопку и ссылку", async () => {
    renderMailbox(() => HttpResponse.json({ enabled: true, messages: [verify, older] }));
    expect(
      await screen.findByRole("heading", { level: 2, name: verify.subject }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 новое")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Подтвердить адрес" })).toHaveAttribute(
      "href",
      verify.action.url,
    );
    await userEvent.click(screen.getByRole("button", { name: /Сброс пароля/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Сброс пароля" })).toBeInTheDocument();
    expect(screen.getByText(older.action.url)).toBeInTheDocument();
    expect(screen.getByText("Всё прочитано")).toBeInTheDocument();
  });
});
