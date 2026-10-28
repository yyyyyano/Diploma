// PROF-03, PROF-05, DES-16: «Что ассистент знает обо мне» — загрузка, ошибка с повтором, пусто, факты по темам с
// источником, датой и статусом; подтвердить, исправить, удалить — сразу и с «Отменить»; «Указать» ключ без значения.
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
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { MemoryPage } from "./MemoryPage.tsx";

const TOKEN = "0199f0a0-0000-7000-8000-0000000000aa";

const children = {
  id: "0199f0a0-0000-7000-8000-0000000000f1",
  topic: "family",
  value: {
    key: "children",
    children: [
      { name: "Максим", birthDate: "2009-03-14", age: null, ageOn: null, disability: false },
      { name: null, birthDate: null, age: 9, ageOn: "2026-10-02", disability: false },
    ],
  },
  source: "chat",
  sourceRef: "0199f0a0-0000-7000-8000-00000000a001",
  status: "confirmed",
  recordedOn: "2026-10-12",
  evaluation: { onDate: "2026-10-28", childAges: [17, 9], childrenUnder18: 2 },
};

const car = {
  id: "0199f0a0-0000-7000-8000-0000000000f2",
  topic: "property",
  value: { key: "property.car", value: true },
  source: "system",
  sourceRef: null,
  status: "assumed",
  recordedOn: "2026-10-18",
  evaluation: null,
};

function renderPage() {
  const root = createRootRoute();
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/memory", component: MemoryPage }),
    createRoute({ getParentRoute: () => root, path: "/settings", component: () => null }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/memory"] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function factsResponse(facts: readonly unknown[]) {
  return http.get("*/api/profile/facts", () => HttpResponse.json({ onDate: "2026-10-28", facts }));
}

describe("DES-16: состояния экрана", () => {
  it("загрузка — скелетоны", async () => {
    server.use(
      http.get("*/api/profile/facts", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderPage();
    expect(await screen.findAllByText("Загрузка…")).not.toHaveLength(0);
  });

  it("ошибка — что случилось; «Попробовать ещё раз» загружает снова", async () => {
    let fail = true;
    server.use(
      http.get("*/api/profile/facts", () =>
        fail
          ? HttpResponse.json(
              {
                defined: false,
                code: "INTERNAL",
                status: 500,
                message: "INTERNAL",
                data: { requestId: "req-00000001", params: {} },
              },
              { status: 500 },
            )
          : HttpResponse.json({ onDate: "2026-10-28", facts: [] }),
      ),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Не удалось загрузить факты" }),
    ).toBeVisible();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Попробовать ещё раз" }));
    expect(
      await screen.findByRole("heading", { name: "Ассистент пока ничего о вас не знает" }),
    ).toBeInTheDocument();
  });

  it("пусто — что здесь будет, а ключи PROF-01 — «Не указано · Указать»", async () => {
    server.use(factsResponse([]));
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Ассистент пока ничего о вас не знает" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Указать: Дети" })).toBeInTheDocument();
  });
});

describe("PROF-05: факты по темам с источником, датой и статусом", () => {
  it("дети с возрастом на сегодня, источник «вы сказали в чате», дата; предположение — с «Верно»", async () => {
    server.use(factsResponse([children, car]));
    renderPage();
    const family = await screen.findByRole("region", { name: "Семья и дети" });
    expect(within(family).getByText("2 ребёнка — 17 лет, 9 лет")).toBeInTheDocument();
    expect(within(family).getByText("вы сказали в чате")).toBeInTheDocument();
    expect(within(family).getByText("12.10.2026")).toBeInTheDocument();
    expect(within(family).getByText("Подтверждён")).toBeInTheDocument();
    const property = screen.getByRole("region", { name: "Имущество" });
    expect(within(property).getByText("Предположение")).toBeInTheDocument();
    expect(within(property).getByRole("button", { name: "Верно: Автомобиль" })).toBeInTheDocument();
    expect(screen.getByText("Проверьте предположение")).toBeInTheDocument();
  });

  it("удалить — сразу, тост «Удалил…» с «Отменить», который зовёт actions.undo", async () => {
    const calls: string[] = [];
    server.use(
      factsResponse([children]),
      http.post("*/api/profile/facts/delete", async ({ request }) => {
        calls.push(`delete:${JSON.stringify(await request.json())}`);
        return HttpResponse.json({ undoToken: TOKEN });
      }),
      http.post("*/api/actions/undo", async ({ request }) => {
        calls.push(`undo:${JSON.stringify(await request.json())}`);
        return HttpResponse.json({ status: "undone" });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Удалить: Дети" }));
    expect(await screen.findByText("Удалил: Дети")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Отменить" }));
    await screen.findByRole("region", { name: "Семья и дети" });
    expect(calls).toEqual([
      `delete:${JSON.stringify({ id: children.id })}`,
      `undo:${JSON.stringify({ token: TOKEN })}`,
    ]);
  });

  it("предположение «Да, верно» — подтверждение одним нажатием", async () => {
    const confirmed: unknown[] = [];
    server.use(
      factsResponse([car]),
      http.post("*/api/profile/facts/confirm", async ({ request }) => {
        confirmed.push(await request.json());
        return HttpResponse.json({ fact: { ...car, status: "confirmed" }, undoToken: TOKEN });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Да, верно" }));
    expect(await screen.findByText("Подтверждено: Автомобиль")).toBeInTheDocument();
    expect(confirmed).toEqual([{ id: car.id }]);
  });

  it("«Указать» многодетность — форма по ключу, сохранение — setFact", async () => {
    const saved: unknown[] = [];
    server.use(
      factsResponse([]),
      http.post("*/api/profile/facts", async ({ request }) => {
        saved.push(await request.json());
        return HttpResponse.json({
          fact: { ...car, topic: "family", value: { key: "largeFamily", value: false } },
          undoToken: TOKEN,
        });
      }),
    );
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Указать: Многодетная семья" }),
    );
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Сохранить" });
    expect(save).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Нет" }));
    await userEvent.click(save);
    expect(await screen.findByText("Запомнил: Многодетная семья")).toBeInTheDocument();
    expect(saved).toEqual([{ value: { key: "largeFamily", value: false } }]);
  });

  it("«Добавить факт» — своя тема, подпись и значение", async () => {
    const saved: unknown[] = [];
    server.use(
      factsResponse([]),
      http.post("*/api/profile/facts", async ({ request }) => {
        saved.push(await request.json());
        return HttpResponse.json({
          fact: {
            ...car,
            topic: "other",
            value: { key: "note", topic: "other", label: "Кружок", text: "60 BYN" },
          },
          undoToken: TOKEN,
        });
      }),
    );
    renderPage();
    await userEvent.click((await screen.findAllByRole("button", { name: "Добавить факт" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Что это" }), "Кружок");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Значение" }), "60 BYN");
    await userEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Запомнил: Кружок")).toBeInTheDocument();
    expect(saved).toEqual([
      { value: { key: "note", topic: "other", label: "Кружок", text: "60 BYN" } },
    ]);
  });
});
