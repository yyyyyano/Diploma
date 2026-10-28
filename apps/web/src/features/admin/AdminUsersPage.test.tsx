// ADM-30, AUTH-05, AUTH-12, R37: «Пользователи» — учётные записи с отметками «вы», почтой, статусом, ролью и режимом
// ИИ; меню строки: блокировка (последний администратор — текст LAST_ADMIN), сброс пароля письмом или ссылкой в окне с
// предупреждением, удаление — только после ввода email удаляемого; ошибка загрузки — понятный текст.
import type { AdminUser } from "@kosht/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { AdminUsersPage } from "./AdminUsersPage.tsx";

const ID = (k: number) => `019a2b3c-0000-7000-8000-0000000000${String(k).padStart(2, "0")}`;

const user = (k: number, extra: Partial<AdminUser>): AdminUser => ({
  id: ID(k),
  email: `user${String(k)}@example.test`,
  registeredAt: "2026-10-02T09:00:00.000Z",
  emailVerified: true,
  status: "active",
  role: "user",
  demo: false,
  telegram: false,
  cloud: false,
  self: false,
  ...extra,
});

const rootUser = user(1, { email: "root@example.test", role: "admin", self: true, cloud: true });
const irina = user(2, { email: "irina@example.test", emailVerified: false });

function renderUsers(items: AdminUser[] = [rootUser, irina]) {
  server.use(http.get("*/api/admin/users", () => HttpResponse.json({ items })));
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AdminUsersPage />
    </QueryClientProvider>,
  );
}

const errorResponse = (code: string, status: number) =>
  HttpResponse.json(
    { defined: true, code, status, message: code, data: { requestId: "req-00000001", params: {} } },
    { status },
  );

async function openMenu(email: string) {
  await userEvent.click(await screen.findByRole("button", { name: `Действия с ${email}` }));
}

describe("ADM-30: список пользователей", () => {
  it("строки — email с отметкой «вы», почта, статус, роль, Telegram и режим ИИ; в заголовке — сколько", async () => {
    renderUsers();
    expect(await screen.findByRole("heading", { name: "Пользователи · 2" })).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      "root@example.testвыс 02.10.2026ПодтвержденаАктивенАдминистраторнетОблачный",
      "irina@example.testс 02.10.2026Не подтвержденаАктивенПользовательнетЛокальный",
    ]);
  });

  it("ошибка загрузки — понятный текст", async () => {
    server.use(http.get("*/api/admin/users", () => errorResponse("INTERNAL", 500)));
    renderWithProviders(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AdminUsersPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось загрузить пользователей",
    );
  });
});

describe("AUTH-11, AUTH-12: блокировка из меню", () => {
  it("«Заблокировать» — сразу, итог строкой", async () => {
    const sent: unknown[] = [];
    server.use(
      http.post("*/api/admin/users/status", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    renderUsers();
    await openMenu("irina@example.test");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Заблокировать" }));
    expect(
      await screen.findByText("irina@example.test заблокирован — его сессии завершены."),
    ).toBeInTheDocument();
    expect(sent).toEqual([{ id: ID(2), status: "blocked" }]);
  });

  it("последний администратор — сообщение LAST_ADMIN, а не тишина", async () => {
    server.use(http.post("*/api/admin/users/role", () => errorResponse("LAST_ADMIN", 409)));
    renderUsers();
    await openMenu("root@example.test");
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Снять роль администратора" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/администратор/i);
  });
});

describe("AUTH-05, R37: сброс пароля", () => {
  it("почты нет — окно со ссылкой и предупреждением о журнале", async () => {
    server.use(
      http.post("*/api/admin/users/reset-password", () =>
        HttpResponse.json({
          delivery: "shown",
          link: "http://127.0.0.1:8140/recovery?token=abc",
        }),
      ),
    );
    renderUsers();
    await openMenu("irina@example.test");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Сбросить пароль" }));
    const dialog = await screen.findByRole("dialog", { name: "Ссылка для сброса пароля" });
    expect(
      within(dialog).getByText("http://127.0.0.1:8140/recovery?token=abc"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/записано в журнал/)).toBeInTheDocument();
  });

  it("почта подтверждена — ссылка ушла письмом, администратор её не видит", async () => {
    server.use(
      http.post("*/api/admin/users/reset-password", () => HttpResponse.json({ delivery: "email" })),
    );
    renderUsers([rootUser, user(3, { email: "pavel@example.test" })]);
    await openMenu("pavel@example.test");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Сбросить пароль" }));
    expect(
      await screen.findByText("Ссылка для сброса пароля отправлена pavel@example.test на почту."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ADM-30: удаление с подтверждением email", () => {
  it("не тот email — подсказка и запроса нет; верный — удаление и итог", async () => {
    const sent: unknown[] = [];
    server.use(
      http.post("*/api/admin/users/delete", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    renderUsers();
    await openMenu("irina@example.test");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Удалить…" }));
    const dialog = await screen.findByRole("dialog", { name: "Удалить пользователя безвозвратно" });
    const input = within(dialog).getByLabelText("Чтобы подтвердить, введите email пользователя");
    await userEvent.type(input, "root@example.test");
    await userEvent.click(within(dialog).getByRole("button", { name: "Удалить навсегда" }));
    expect(
      await within(dialog).findByText("Email не совпадает с адресом удаляемого пользователя."),
    ).toBeInTheDocument();
    expect(sent).toEqual([]);
    await userEvent.clear(input);
    await userEvent.type(input, "Irina@Example.test");
    await userEvent.click(within(dialog).getByRole("button", { name: "Удалить навсегда" }));
    expect(
      await screen.findByText("irina@example.test удалён вместе с данными."),
    ).toBeInTheDocument();
    expect(sent).toEqual([{ id: ID(2), email: "Irina@Example.test" }]);
  });
});
