// NOTIF-01, NOTIF-03, NOTIF-05: колокольчик — счётчик непрочитанных в имени кнопки, список из ленты, «Показать ещё» по
// курсору, «Прочитать все», блок администратора только для admin; кнопки «Да» и «Отменить» уведомления — в actions.
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
import { NotificationBell } from "./NotificationBell.tsx";

const n = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "statement-imported",
  params: {},
  objectRef: null,
  decisionId: null,
  undoToken: null,
  read: false,
  createdAt: "2026-10-26T09:00:00.000Z",
  ...extra,
});

const ID = (k: number) => `0199f0a0-0000-7000-8000-0000000000${String(k).padStart(2, "0")}`;

function renderBell(admin = false) {
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/",
        component: () => <NotificationBell admin={admin} />,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/settings",
        component: () => <p>Настройки</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("NOTIF-01: колокольчик", () => {
  it("счётчик в имени кнопки; список; «Показать ещё» по курсору; «Прочитать все»", async () => {
    const cursors: (string | null)[] = [];
    let readAll = 0;
    server.use(
      http.get("*/api/notifications", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return HttpResponse.json(
          cursor === null
            ? { items: [n(ID(2), { kind: "deduction" })], nextCursor: ID(2), unread: 2 }
            : {
                items: [n(ID(1), { kind: "weekly-summary", read: true })],
                nextCursor: null,
                unread: 2,
              },
        );
      }),
      http.post("*/api/notifications/read-all", () => {
        readAll += 1;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderBell();
    const bell = await screen.findByRole("button", { name: "Уведомления: 2 непрочитанных" });
    await userEvent.click(bell);
    expect(await screen.findByText(/Найден налоговый вычет/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(await screen.findByText("Итоги недели готовы.")).toBeInTheDocument();
    expect(cursors).toEqual([null, ID(2)]);
    await userEvent.click(screen.getByRole("button", { name: "Прочитать все" }));
    await expect.poll(() => readAll).toBe(1);
    expect(screen.getByRole("link", { name: "Настроить уведомления" })).toHaveAttribute(
      "href",
      "/settings?tab=notifications",
    );
  });

  it("TAX-20: «найден вычет» — текст по виду и сумме из параметров (копейки → «260,00 BYN»), «Показать» ведёт в «Налоговые вычеты»", async () => {
    server.use(
      http.get("*/api/notifications", () =>
        HttpResponse.json({
          items: [
            n(ID(3), {
              kind: "deduction",
              params: { kind: "education", amount: 26_000 },
              objectRef: { entity: "deduction", id: ID(9) },
            }),
          ],
          nextCursor: null,
          unread: 1,
        }),
      ),
    );
    renderBell();
    await userEvent.click(await screen.findByRole("button", { name: /Уведомления/ }));
    expect(
      await screen.findByText(/Найден вычет на обучение: можно вернуть до 260,00/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Показать" })).toHaveAttribute("href", "/deductions");
  });

  it("CAL-07: напоминание календаря — текст по типу и дням, время «сегодня, чч:мм», «Показать» ведёт в календарь", async () => {
    server.use(
      http.get("*/api/notifications", () =>
        HttpResponse.json({
          items: [
            n(ID(4), {
              kind: "calendar-reminder",
              params: { type: "warranty", title: "Наушники", days: 7, on: "2026-11-18" },
              objectRef: { entity: "calendar-event", id: ID(8) },
              createdAt: new Date().toISOString(),
            }),
            n(ID(5), {
              kind: "calendar-reminder",
              params: { type: "own", title: "Оплатить садик", days: 1, on: "2026-12-01" },
              objectRef: { entity: "calendar-event", id: ID(7) },
              read: true,
            }),
          ],
          nextCursor: null,
          unread: 1,
        }),
      ),
    );
    renderBell();
    await userEvent.click(await screen.findByRole("button", { name: /Уведомления/ }));
    expect(
      await screen.findByText(
        "Гарантия на «Наушники» заканчивается через 7 дней — проверьте, всё ли работает.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Напоминание: «Оплатить садик» — завтра.")).toBeInTheDocument();
    expect(screen.getByText(/^сегодня, \d{2}:\d{2}$/u)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Показать" })[0]).toHaveAttribute(
      "href",
      "/calendar",
    );
  });

  it("Escape закрывает список и возвращает фокус колокольчику (NFR-20)", async () => {
    server.use(
      http.get("*/api/notifications", () =>
        HttpResponse.json({ items: [], nextCursor: null, unread: 0 }),
      ),
    );
    renderBell();
    const bell = await screen.findByRole("button", { name: "Уведомления" });
    await userEvent.click(bell);
    expect(await screen.findByRole("heading", { name: "Уведомления" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => screen.queryByRole("heading", { name: "Уведомления" })).toBeNull();
    expect(bell).toHaveFocus();
  });

  it("пусто — что здесь появится; администратору — его уведомления отдельным блоком", async () => {
    server.use(
      http.get("*/api/notifications", () =>
        HttpResponse.json({ items: [], nextCursor: null, unread: 0 }),
      ),
      http.get("*/api/notifications/admin", () =>
        HttpResponse.json({
          items: [
            {
              id: ID(9),
              kind: "law-new-acts",
              params: {},
              objectRef: null,
              read: false,
              createdAt: "2026-10-26T09:00:00.000Z",
            },
          ],
          nextCursor: null,
          unread: 1,
        }),
      ),
    );
    renderBell(true);
    await userEvent.click(
      await screen.findByRole("button", { name: "Уведомления: 1 непрочитанное" }),
    );
    expect(await screen.findByText("Для администратора")).toBeInTheDocument();
    expect(screen.getByText("В правовую базу добавлены новые акты.")).toBeInTheDocument();
  });
});

describe("NOTIF-05: кнопки в уведомлении", () => {
  it("«Да» — ответ в actions по decisionId и отметка «прочитано»; «Показать» — ссылка на объект", async () => {
    let answered: unknown;
    let read: unknown;
    server.use(
      http.get("*/api/notifications", () =>
        HttpResponse.json({
          items: [
            n(ID(3), {
              kind: "receipt-match",
              decisionId: ID(40),
              objectRef: { entity: "receipt", id: ID(50) },
            }),
          ],
          nextCursor: null,
          unread: 1,
        }),
      ),
      http.post("*/api/actions/answer", async ({ request }) => {
        answered = await request.json();
        return HttpResponse.json({ status: "yes" });
      }),
      http.post("*/api/notifications/read", async ({ request }) => {
        read = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderBell();
    await userEvent.click(await screen.findByRole("button", { name: /Уведомления/ }));
    expect(await screen.findByRole("link", { name: "Показать" })).toHaveAttribute(
      "href",
      `/documents?open=${ID(50)}`,
    );
    await userEvent.click(screen.getByRole("button", { name: "Да" }));
    expect(await screen.findByText("Готово.")).toBeInTheDocument();
    expect(answered).toEqual({ id: ID(40), answer: "yes" });
    expect(read).toEqual({ ids: [ID(3)] });
  });

  it("«Отменить» — отмена в actions по undoToken", async () => {
    let undone: unknown;
    server.use(
      http.get("*/api/notifications", () =>
        HttpResponse.json({
          items: [n(ID(4), { undoToken: ID(60), read: true })],
          nextCursor: null,
          unread: 0,
        }),
      ),
      http.post("*/api/actions/undo", async ({ request }) => {
        undone = await request.json();
        return HttpResponse.json({ status: "undone" });
      }),
    );
    renderBell();
    await userEvent.click(await screen.findByRole("button", { name: "Уведомления" }));
    await userEvent.click(await screen.findByRole("button", { name: "Отменить" }));
    expect(await screen.findByText("Отменено.")).toBeInTheDocument();
    expect(undone).toEqual({ token: ID(60) });
  });
});
