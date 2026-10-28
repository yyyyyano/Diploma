// PRIV-05, PRIV-06: вкладка «Мои данные». Архив: нет — «Подготовить», готовится — «Готовим», готов — имя, размер, дата
// и ссылка на файл, не удался — «заново». Удаление аккаунта: окно с перечнем и паролем; без пароля запроса нет;
// неверный — «Неверный пароль.»; верный — кэш очищен, на вход.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { SettingsSearch } from "./model/search.ts";
import { SettingsPage } from "./SettingsPage.tsx";

const FILE_ID = "019a2b3c-0000-7000-8000-000000000001";

function renderTab(tab: "my-data") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
      createRoute({
        getParentRoute: () => root,
        path: "/policy",
        component: () => <p>Политика</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [`/settings?tab=${tab}`] }),
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

const errorResponse = (code: string, status: number) =>
  HttpResponse.json(
    { defined: true, code, status, message: code, data: { requestId: "req-00000001", params: {} } },
    { status },
  );

describe("PRIV-05: архив «Мои данные»", () => {
  it("архива нет — «Подготовить архив» ставит заявку и показывает, что архив готовится", async () => {
    let requested = 0;
    server.use(
      http.get("*/api/privacy/export", () =>
        HttpResponse.json({ status: "none", requestedAt: null, finishedAt: null, file: null }),
      ),
      http.post("*/api/privacy/export", () => {
        requested += 1;
        return HttpResponse.json({
          status: "pending",
          requestedAt: "2026-10-28T09:00:00.000Z",
          finishedAt: null,
          file: null,
        });
      }),
    );
    renderTab("my-data");
    await userEvent.click(await screen.findByRole("button", { name: "Подготовить архив" }));
    expect(await screen.findByText(/Готовим архив/)).toBeInTheDocument();
    expect(requested).toBe(1);
    expect(screen.queryByRole("button", { name: "Подготовить архив" })).toBeNull();
  });

  it("готов — имя, размер и дата, «Скачать» ведёт на файл владельца", async () => {
    server.use(
      http.get("*/api/privacy/export", () =>
        HttpResponse.json({
          status: "ready",
          requestedAt: "2026-10-28T09:00:00.000Z",
          finishedAt: "2026-10-28T09:01:00.000Z",
          file: { id: FILE_ID, name: "kosht-my-data-2026-10-28.zip", size: 19_293_798 },
        }),
      ),
    );
    renderTab("my-data");
    expect(await screen.findByText("kosht-my-data-2026-10-28.zip")).toBeInTheDocument();
    expect(
      screen.getByText(
        // Неразрывный пробел перед «МБ» поиск по тексту приводит к обычному.
        "18,4 МБ · JSON и исходные файлы · готов 28.10.2026",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Скачать" })).toHaveAttribute(
      "href",
      `/api/files/${FILE_ID}`,
    );
    expect(screen.getByRole("button", { name: "Подготовить заново" })).toBeInTheDocument();
  });

  it("не удался — понятное сообщение и «Подготовить заново»", async () => {
    server.use(
      http.get("*/api/privacy/export", () =>
        HttpResponse.json({
          status: "failed",
          requestedAt: "2026-10-28T09:00:00.000Z",
          finishedAt: "2026-10-28T09:01:00.000Z",
          file: null,
        }),
      ),
    );
    renderTab("my-data");
    expect(await screen.findByRole("alert")).toHaveTextContent("Архив не получился");
    expect(screen.getByRole("button", { name: "Подготовить заново" })).toBeInTheDocument();
  });
});

describe("PRIV-06: удаление аккаунта", () => {
  function withExport() {
    server.use(
      http.get("*/api/privacy/export", () =>
        HttpResponse.json({ status: "none", requestedAt: null, finishedAt: null, file: null }),
      ),
    );
  }

  it("окно с перечнем; без пароля запроса нет; неверный пароль — «Неверный пароль.», аккаунт на месте", async () => {
    withExport();
    const sent: unknown[] = [];
    server.use(
      http.post("*/api/identity/delete-account", async ({ request }) => {
        sent.push(await request.json());
        return errorResponse("INVALID_CREDENTIALS", 401);
      }),
    );
    renderTab("my-data");
    await userEvent.click(await screen.findByRole("button", { name: "Удалить аккаунт…" }));
    const dialog = await screen.findByRole("dialog", { name: "Удалить аккаунт безвозвратно" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(4);
    await userEvent.click(within(dialog).getByRole("button", { name: "Удалить навсегда" }));
    expect(
      await within(dialog).findByText("Введите пароль — без него аккаунт не удалить."),
    ).toBeInTheDocument();
    expect(sent).toEqual([]);
    await userEvent.type(within(dialog).getByLabelText("Пароль"), "не-тот-пароль-совсем");
    await userEvent.click(within(dialog).getByRole("button", { name: "Удалить навсегда" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Неверный пароль.");
    expect(sent).toEqual([{ password: "не-тот-пароль-совсем" }]);
    expect(screen.queryByText("Вход")).toBeNull();
  });

  it("верный пароль — аккаунт удалён, кэш очищен, открыт вход", async () => {
    withExport();
    server.use(http.post("*/api/identity/delete-account", () => HttpResponse.json({ ok: true })));
    const { queryClient } = renderTab("my-data");
    await userEvent.click(await screen.findByRole("button", { name: "Удалить аккаунт…" }));
    const dialog = await screen.findByRole("dialog", { name: "Удалить аккаунт безвозвратно" });
    await userEvent.type(within(dialog).getByLabelText("Пароль"), "правильный-пароль-2026");
    await userEvent.click(within(dialog).getByRole("button", { name: "Удалить навсегда" }));
    expect(await screen.findByText("Вход")).toBeInTheDocument();
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });
});
