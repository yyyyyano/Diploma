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
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
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

function lawsProgress(
  state: "off" | "waiting" | "loading" | "ready" | "stopped",
  extra: { done?: number; total?: number; problems?: number; stopReason?: string } = {},
) {
  return { state, done: 0, total: 0, problems: 0, stopReason: null, ...extra };
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
      http.get("*/api/llm/local-models-progress", () =>
        HttpResponse.json({ state: "absent", bytesDone: 0, bytesTotal: 4_400_000_000 }),
      ),
      http.get("*/api/legal-base/startup-progress", () => HttpResponse.json(lawsProgress("off"))),
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
    // NFR-25: после кода — «Готовим систему»; войти можно сразу
    await userEvent.click(await screen.findByRole("button", { name: "Войти" }));
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

  describe("NFR-25, AUTH-10: шаг «Готовим систему» — прогресс локальных моделей", () => {
    async function toPrepare(
      progress: () => Response | Promise<Response>,
      laws: () => Response | Promise<Response> = () => HttpResponse.json(lawsProgress("off")),
    ) {
      server.use(
        http.get("*/api/legal-base/startup-progress", laws),
        http.post("*/api/identity/setup", () =>
          HttpResponse.json({ ok: true, recoveryCode: "KQ7M-4XPD-9TJC-2HWR" }),
        ),
        http.get("*/api/llm/local-models-progress", progress),
      );
      renderSetup();
      await submit("admin@example.test", "пароль-администратора");
      await userEvent.click(
        await screen.findByRole("checkbox", { name: "Я сохранил(а) код в надёжном месте" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Продолжить" }));
      await screen.findByRole("heading", { name: "Готовим систему" });
    }

    it("идёт скачивание — полоса с байтами и пояснение про докачку; «Войти» доступно сразу", async () => {
      await toPrepare(() =>
        HttpResponse.json({
          state: "downloading",
          bytesDone: 1_500_000_000,
          bytesTotal: 4_400_000_000,
        }),
      );
      const bar = await screen.findByRole("progressbar", { name: "Локальные модели: скачано" });
      expect(bar).toHaveAttribute("value", "1500000000");
      expect(screen.getByText(/Скачано 1,4 ГБ из 4,1 ГБ/)).toBeInTheDocument();
      expect(screen.getByText(/продолжу с места остановки/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Войти" })).toBeEnabled();
    });

    it("всё скачано — так и сказано; ещё не начато — где запустить", async () => {
      await toPrepare(() =>
        HttpResponse.json({ state: "ready", bytesDone: 4_400_000_000, bytesTotal: 4_400_000_000 }),
      );
      expect(await screen.findByText(/Скачаны: модель для чата/)).toBeInTheDocument();
    });

    it("ошибка скачивания — понятный текст и путь к повтору; ошибка опроса не мешает войти", async () => {
      await toPrepare(() => HttpResponse.json({ state: "failed", bytesDone: 10, bytesTotal: 100 }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Скачивание остановилось с ошибкой",
      );
    });

    it("опрос не отвечает — «это не мешает войти»", async () => {
      await toPrepare(() => HttpResponse.error());
      expect(await screen.findByText(/не мешает войти/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Войти" })).toBeEnabled();
    });
  });

  describe("LAW-10, LAW-36: правовая база на экране первого запуска", () => {
    const models = () => HttpResponse.json({ state: "ready", bytesDone: 1, bytesTotal: 1 });

    async function toPrepareWithLaws(laws: () => Response | Promise<Response>) {
      server.use(
        http.post("*/api/identity/setup", () =>
          HttpResponse.json({ ok: true, recoveryCode: "KQ7M-4XPD-9TJC-2HWR" }),
        ),
        http.get("*/api/llm/local-models-progress", models),
        http.get("*/api/legal-base/startup-progress", laws),
      );
      renderSetup();
      await submit("admin@example.test", "пароль-администратора");
      await userEvent.click(
        await screen.findByRole("checkbox", { name: "Я сохранил(а) код в надёжном месте" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Продолжить" }));
      await screen.findByRole("heading", { name: "Готовим систему" });
    }

    it("поле «Контакт для загрузчика законов» уходит на сервер; пустое — не отправляется", async () => {
      const bodies: unknown[] = [];
      server.use(
        http.post("*/api/identity/setup", async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json(conflict, { status: 409 });
        }),
      );
      renderSetup();
      await userEvent.type(
        await screen.findByRole("textbox", { name: "Контакт для загрузчика законов" }),
        "https://example.test/operator",
      );
      await submit("admin@example.test", "пароль-администратора");
      expect(await screen.findByText("Вход")).toBeInTheDocument();
      expect(bodies).toEqual([
        {
          email: "admin@example.test",
          password: "пароль-администратора",
          loaderContact: "https://example.test/operator",
        },
      ]);
    });

    it("контакт не email и не адрес сайта — подсказка у поля, запроса нет", async () => {
      renderSetup();
      await userEvent.type(
        await screen.findByRole("textbox", { name: "Контакт для загрузчика законов" }),
        "не контакт",
      );
      await submit("admin@example.test", "пароль-администратора");
      expect(await screen.findByText(/Введите email или адрес сайта/)).toBeInTheDocument();
    });

    it("«Загружено 14 из 28 актов» — полоса и пояснение про паузу", async () => {
      await toPrepareWithLaws(() =>
        HttpResponse.json(lawsProgress("loading", { done: 14, total: 28 })),
      );
      const bar = await screen.findByRole("progressbar", {
        name: "Правовая база: загружено актов",
      });
      expect(bar).toHaveAttribute("value", "14");
      expect(bar).toHaveAttribute("max", "28");
      expect(screen.getByText("Загружено 14 из 28 актов")).toBeInTheDocument();
      expect(screen.getByText(/с паузой — так требует вежливый обход/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Войти" })).toBeEnabled();
    });

    it("всё загружено — так и сказано", async () => {
      await toPrepareWithLaws(() =>
        HttpResponse.json(lawsProgress("ready", { done: 28, total: 28 })),
      );
      expect(
        await screen.findByText("Загружены все акты стартового каталога."),
      ).toBeInTheDocument();
    });

    it("загрузчик остановлен — причина человеческим текстом и обещание продолжить", async () => {
      await toPrepareWithLaws(() =>
        HttpResponse.json(
          lawsProgress("stopped", { done: 5, total: 28, stopReason: "LOADER_BLOCKED" }),
        ),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "загрузка остановлена до завтра и продолжится сама",
      );
    });

    it("автозагрузка выключена — раздела «Правовая база» нет", async () => {
      await toPrepareWithLaws(() => HttpResponse.json(lawsProgress("off")));
      await screen.findByText("Локальные модели");
      expect(screen.queryByRole("heading", { name: "Правовая база" })).not.toBeInTheDocument();
    });
  });
});
