// AFF-01, AFF-03, AFF-05, AFF-08, DES-16: экран «Могу ли я позволить покупку?» — быстрые суммы и ползунок отправляют сумму на сервер
// (сайт денег не считает), ответ показан как есть; безопасный платёж со ставкой и сроком; доход при его отсутствии; состояния.
// Сеть — MSW; задержка пересчёта (400 мс) настоящая — тесты ждут ответа сервера, а не таймеров.
import type { Money } from "@kosht/kernel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  LOAN_NO_LIMIT,
  LOAN_OK,
  NEEDS_INCOME,
  RISKY,
  SAFE,
} from "../../entities/afford/fixtures.ts";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { AffordPage } from "./AffordPage.tsx";
import type { AffordSearch } from "./model/search.ts";

async function renderPage(search: AffordSearch = {}) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/afford",
    component: () => <AffordPage search={search} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ["/afford"] }),
  });
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  // Страница — ленивый чанк за маршрутизатором: ждём форму, потом действуем.
  await screen.findByText("Что и когда хотите купить");
}

interface Sent {
  scenarios: { price: Money; on?: string; expectedIncome?: Money; expectedIncomeOn?: string }[];
  loan: { domesticGoods?: boolean; rateBp?: number; months?: number; income?: Money }[];
}

/** Сервер-заглушка: записывает вход обеих процедур, отвечает заданными результатами. */
function backend(options: { scenarios?: unknown; loan?: unknown } = {}): Sent {
  const sent: Sent = { scenarios: [], loan: [] };
  server.use(
    http.post("*/api/afford/scenarios", async ({ request }) => {
      sent.scenarios.push((await request.json()) as never);
      return HttpResponse.json(options.scenarios ?? RISKY);
    }),
    http.post("*/api/afford/safe-loan", async ({ request }) => {
      sent.loan.push((await request.json()) as never);
      return HttpResponse.json(options.loan ?? LOAN_OK);
    }),
  );
  return sent;
}

describe("DES-16: состояния", () => {
  it("пусто: «введите сумму», ни одного запроса сценариев; безопасный платёж виден сразу", async () => {
    const sent = backend();
    await renderPage();
    expect(
      await screen.findByText("Введите сумму или выберите быструю — покажу три сценария"),
    ).toBeVisible();
    expect(await screen.findByText("Безопасный платёж по кредиту")).toBeVisible();
    expect(sent.scenarios).toEqual([]);
  });

  it("ошибка сервера — строка с причиной и «Повторить», повтор спрашивает сервер ещё раз", async () => {
    let calls = 0;
    server.use(
      http.post("*/api/afford/safe-loan", () => HttpResponse.json(LOAN_OK)),
      http.post("*/api/afford/scenarios", () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ code: "INTERNAL", status: 500, message: "x" }, { status: 500 })
          : HttpResponse.json(SAFE);
      }),
    );
    await renderPage({ sum: "1500" });
    expect(
      await screen.findByText("Не удалось посчитать сценарии. Проверьте сумму и повторите"),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findAllByRole("article")).toHaveLength(3);
  });

  it("неверная сумма — подсказка у поля и запроса нет", async () => {
    const sent = backend();
    await renderPage();
    await userEvent.type(screen.getByLabelText("Сумма, BYN"), "abc");
    expect(await screen.findByText(/Введите сумму больше нуля/u)).toBeVisible();
    expect(sent.scenarios).toEqual([]);
  });
});

describe("AFF-01, AFF-03: сумма уходит на сервер, ответ показан как есть", () => {
  it("быстрая сумма 3 000 → price 300 000 копеек; три сценария, минимум −739,44 и риск из ответа", async () => {
    const sent = backend();
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: /^3\s000$/u }));
    expect(await screen.findAllByRole("article")).toHaveLength(3);
    expect(sent.scenarios.at(-1)).toEqual({ price: { minor: 300_000, currency: "BYN" } });
    const first = screen.getAllByRole("article")[0] as HTMLElement;
    expect(within(first).getByText("Риск просадки")).toBeVisible();
    expect(within(first).getByText(/−739,44/u)).toBeVisible();
  });

  it("название покупки — в заголовке результата («Ноутбук за 3 000,00 BYN»)", async () => {
    backend();
    await renderPage();
    await userEvent.type(screen.getByLabelText("Что покупаете"), "Ноутбук");
    await userEvent.click(screen.getByRole("button", { name: /^3\s000$/u }));
    expect(
      await screen.findByRole("heading", { name: /^Ноутбук за 3\s000,00\sBYN — три сценария$/u }),
    ).toBeVisible();
  });

  it("сумма в адресе (карточка главной) считается сразу; сумма вводом — тоже с копейками: «1 250,50»", async () => {
    const sent = backend({ scenarios: SAFE });
    await renderPage({ sum: "1500" });
    expect(await screen.findAllByRole("article")).toHaveLength(3);
    expect(sent.scenarios[0]?.price).toEqual({ minor: 150_000, currency: "BYN" });
    await userEvent.clear(screen.getByLabelText("Сумма, BYN"));
    await userEvent.type(screen.getByLabelText("Сумма, BYN"), "1 250,50");
    await waitFor(() =>
      expect(sent.scenarios.at(-1)?.price).toEqual({ minor: 125_050, currency: "BYN" }),
    );
  });

  it("«Другая дата» — день уходит как `on`; без выбора «Сейчас» дня во входе нет", async () => {
    const sent = backend();
    await renderPage();
    await userEvent.type(screen.getByLabelText("Сумма, BYN"), "3000");
    await waitFor(() => expect(sent.scenarios.length).toBeGreaterThan(0));
    expect(sent.scenarios.at(-1)).not.toHaveProperty("on");
    await userEvent.click(screen.getByText("Другая дата"));
    await userEvent.type(screen.getByLabelText("День покупки"), "2026-11-10");
    await waitFor(() => expect(sent.scenarios.at(-1)?.on).toBe("2026-11-10"));
  });

  it("день вне горизонта — сервер отвечает VALIDATION { field: on }: подсказка у поля дня", async () => {
    server.use(
      http.post("*/api/afford/safe-loan", () => HttpResponse.json(LOAN_OK)),
      http.post("*/api/afford/scenarios", ({ request }) =>
        request
          .clone()
          .json()
          .then((body: unknown) =>
            (body as { on?: string }).on === undefined
              ? HttpResponse.json(RISKY)
              : HttpResponse.json(
                  {
                    defined: true,
                    code: "VALIDATION",
                    status: 400,
                    message: "VALIDATION",
                    data: { requestId: "r-1", params: { field: "on" } },
                  },
                  { status: 400 },
                ),
          ),
      ),
    );
    await renderPage({ sum: "3000" });
    expect(await screen.findAllByRole("article")).toHaveLength(3);
    await userEvent.click(screen.getByText("Другая дата"));
    await userEvent.type(screen.getByLabelText("День покупки"), "2030-01-01");
    expect(await screen.findByText(/Этот день вне периода прогноза/u)).toBeVisible();
  });
});

describe("AFF-08: доход не найден", () => {
  it("ответ с needs = income показывает вопрос; названный доход и день уходят на сервер, расчёт обновляется", async () => {
    const sent = backend({ scenarios: NEEDS_INCOME });
    await renderPage({ sum: "3000" });
    expect(await screen.findByText("Регулярный доход не найден", { selector: "p" })).toBeVisible();
    await userEvent.type(screen.getByLabelText("Доход в месяц, BYN"), "2400");
    await userEvent.type(screen.getByLabelText("День поступления"), "2026-11-05");
    await userEvent.click(screen.getByRole("button", { name: "Пересчитать" }));
    await waitFor(() =>
      expect(sent.scenarios.at(-1)).toMatchObject({
        expectedIncome: { minor: 240_000, currency: "BYN" },
        expectedIncomeOn: "2026-11-05",
      }),
    );
  });
});

describe("AFF-05, AFF-06: безопасный платёж", () => {
  it("пример SPEC: платёж до 480,00 из ответа сервера; ставка и срок пустые → просьба их назвать", async () => {
    backend({ loan: { ...LOAN_OK, maxLoan: null } });
    await renderPage();
    const block = await screen.findByRole("region", { name: "Безопасный платёж по кредиту" });
    expect(within(block).getAllByText("480,00").length).toBeGreaterThan(0);
    expect(within(block).getByText(/Укажите ставку и срок/u)).toBeVisible();
  });

  it("ставка 14 и срок 60 → rateBp 1400 и months 60 на сервере; переключатель «белорусские товары» → domesticGoods", async () => {
    const sent = backend();
    await renderPage();
    await screen.findByRole("region", { name: "Безопасный платёж по кредиту" });
    await userEvent.type(screen.getByLabelText("Ставка, % годовых"), "14");
    await userEvent.clear(screen.getByLabelText("Срок, месяцев"));
    await userEvent.type(screen.getByLabelText("Срок, месяцев"), "60");
    await waitFor(() => expect(sent.loan.at(-1)).toMatchObject({ rateBp: 1400, months: 60 }));
    await userEvent.click(screen.getByRole("switch", { name: /Кредит на белорусские товары/u }));
    await waitFor(() => expect(sent.loan.at(-1)?.domesticGoods).toBe(true));
  });

  it("ставка не число — подсказка, ставка и срок на сервер не уходят", async () => {
    const sent = backend();
    await renderPage();
    await screen.findByRole("region", { name: "Безопасный платёж по кредиту" });
    await userEvent.type(screen.getByLabelText("Ставка, % годовых"), "abc");
    expect(await screen.findByText(/Ставка — число от 0 до 100/u)).toBeVisible();
    expect(sent.loan.every((input) => input.rateBp === undefined)).toBe(true);
  });

  it("предел не подтверждён — «нет предела» и ни одного платежа", async () => {
    backend({ loan: LOAN_NO_LIMIT });
    await renderPage();
    expect(await screen.findByText(/Предел долговой нагрузки ещё не подтверждён/u)).toBeVisible();
    expect(screen.queryByText("Новый платёж — не больше")).toBeNull();
  });
});
