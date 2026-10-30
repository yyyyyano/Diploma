// DES-16, BUD-01…07, EXPL-01, P5, AGT-07: «Лимиты и цели» — четыре состояния; лимиты с полосами на 84 и 112 %; цели с
// рекомендуемым взносом, «укладывается ли в свободный остаток» и отставанием; взнос в копилку с «Отменить»; удаление лимита
// только решением «Да/Нет»; ⓘ → расчёт процента.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { BudgetPage } from "./BudgetPage.tsx";

const TOKEN = "0199f0a0-0000-7000-8000-0000000000aa";
const TRACE = "0199f0a0-0000-7000-8000-0000000000bb";
const ID = (n: number) => `0199f0a0-0000-7000-8000-00000000020${n}`;
const byn = (minor: number) => ({ minor, currency: "BYN" });

const cafe = {
  id: ID(1),
  categoryKey: "system:cafes",
  limit: byn(20_000),
  spent: byn(16_800),
  remaining: byn(3_200),
  percent: 84,
  traceId: TRACE,
  notify80: true,
  notify100: false,
  missingRates: 0,
};
const taxi = {
  ...cafe,
  id: ID(2),
  categoryKey: "system:taxi",
  limit: byn(10_000),
  spent: byn(11_240),
  remaining: byn(-1_240),
  percent: 112,
  notify100: true,
};
const vacation = {
  id: ID(3),
  name: "Отпуск",
  kind: "piggy",
  target: byn(300_000),
  deadline: "2027-06-01",
  createdOn: "2026-10-01",
  accountId: null,
  accountMissing: false,
  saved: byn(60_000),
  percent: 20,
  traceId: TRACE,
  monthsLeft: 7,
  contribution: byn(34_300),
  contributionTraceId: TRACE,
  fitsFreeBalance: true,
  planned: byn(10_000),
  behind: false,
  contributions: [{ id: ID(8), amount: byn(60_000), madeOn: "2026-10-05" }],
};
const reserve = {
  ...vacation,
  id: ID(4),
  name: "Резерв",
  kind: "account",
  accountId: ID(9),
  saved: byn(100_000),
  percent: 33,
  contribution: byn(28_600),
  fitsFreeBalance: false,
  planned: byn(200_000),
  behind: true,
  contributions: [],
};

const OVERVIEW = {
  month: "2026-10",
  daysLeft: 4,
  limits: [cafe, taxi],
  goals: [vacation, reserve],
  freeBalance: byn(172_223),
  freeBalanceTraceId: TRACE,
};

const overview = (over: Record<string, unknown> = {}) =>
  http.get("*/api/budgets", () => HttpResponse.json({ ...OVERVIEW, ...over }));

// Названия категорий приходят из справочника: встроенные — из словаря по коду.
beforeEach(() =>
  server.use(
    http.get("*/api/categories", () =>
      HttpResponse.json({
        items: [
          {
            ref: { type: "system", code: "cafes" },
            kind: "expense",
            name: null,
            icon: "utensils",
            color: "cafes",
            hidden: false,
          },
          {
            ref: { type: "system", code: "taxi" },
            kind: "expense",
            name: null,
            icon: "car-taxi-front",
            color: "taxi",
            hidden: false,
          },
        ],
      }),
    ),
  ),
);

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <BudgetPage />
    </QueryClientProvider>,
  );
}

describe("DES-16: состояния экрана «Лимиты и цели»", () => {
  it("загрузка — скелетоны с «Загрузка…» для диктора", async () => {
    server.use(
      http.get("*/api/budgets", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderPage();
    expect(await screen.findAllByText("Загрузка…")).not.toHaveLength(0);
  });

  it("пусто — что здесь будет и первый шаг для лимитов и для целей", async () => {
    server.use(overview({ limits: [], goals: [], freeBalance: null, freeBalanceTraceId: null }));
    renderPage();
    expect(await screen.findByText("Лимитов пока нет")).toBeInTheDocument();
    expect(screen.getByText("Целей пока нет")).toBeInTheDocument();
  });

  it("ошибка — что случилось и «Повторить»", async () => {
    server.use(http.get("*/api/budgets", () => HttpResponse.json({}, { status: 500 })));
    renderPage();
    expect(await screen.findByText("Лимиты и цели не загрузились")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
  });
});

describe("BUD-02: лимиты", () => {
  it("84 % — внимание с остатком и днями; 112 % — превышение с суммой; полосы с подписью категории", async () => {
    server.use(overview());
    renderPage();
    const cafeCard = await screen.findByRole("article", { name: "Кафе, рестораны и доставка" });
    expect(within(cafeCard).getByText(/84% · осталось 32,00 BYN на 4 дня/)).toBeInTheDocument();
    const bar = within(cafeCard).getByRole("progressbar", { name: "Кафе, рестораны и доставка" });
    expect(bar).toHaveValue(84);
    const taxiCard = screen.getByRole("article", { name: "Такси" });
    expect(within(taxiCard).getByText(/112% · превышен на 12,40 BYN/)).toBeInTheDocument();
    expect(within(taxiCard).getByRole("progressbar", { name: "Такси" })).toHaveValue(100);
    expect(screen.getByText("Октябрь 2026 · до конца месяца 4 дня")).toBeInTheDocument();
  });

  it("ⓘ у суммы лимита открывает сохранённый расчёт процента", async () => {
    server.use(
      overview(),
      http.get("*/api/explain", () =>
        HttpResponse.json({
          id: TRACE,
          trace: { key: "budgets.limitPercent", op: "round", value: 84, inputs: [], refs: [] },
          period: { from: "2026-10-01", to: "2026-10-31" },
          createdAt: "2026-10-28T09:00:00Z",
        }),
      ),
    );
    renderPage();
    const card = await screen.findByRole("article", { name: "Кафе, рестораны и доставка" });
    await userEvent.click(
      within(card).getByRole("button", { name: /Откуда эта цифра: доля лимита/ }),
    );
    expect(await screen.findByText("Откуда эта цифра?")).toBeInTheDocument();
  });

  it("порог 100 % выключен — переключатель отражает состояние; нажатие отправляет лимит с новым флагом", async () => {
    let body: unknown;
    server.use(
      overview(),
      http.post("*/api/budgets/limit", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ limit: { ...cafe, notify100: true }, undoToken: TOKEN });
      }),
    );
    renderPage();
    const card = await screen.findByRole("article", { name: "Кафе, рестораны и доставка" });
    const chip = within(card).getByRole("checkbox", { name: "100%" });
    expect(chip).not.toBeChecked();
    await userEvent.click(chip);
    expect(await screen.findByRole("button", { name: "Отменить" })).toBeInTheDocument();
    expect(body).toEqual({ categoryKey: "system:cafes", limit: byn(20_000), notify100: true });
  });
});

describe("BUD-04, BUD-05, BUD-07: цели", () => {
  it("рекомендуемый взнос, «укладывается» и «не укладывается», отставание от графика", async () => {
    server.use(overview());
    renderPage();
    const piggy = await screen.findByRole("article", { name: "Отпуск" });
    expect(within(piggy).getByText("Откладывайте по 343,00 BYN в месяц")).toBeInTheDocument();
    expect(
      within(piggy).getByText("Укладывается в свободный остаток 1 722,23 BYN"),
    ).toBeInTheDocument();
    expect(within(piggy).getByText("копилка")).toBeInTheDocument();
    expect(within(piggy).getByText("05.10.2026")).toBeInTheDocument();
    const linked = screen.getByRole("article", { name: "Резерв" });
    expect(
      within(linked).getByText("Не укладывается в свободный остаток 1 722,23 BYN"),
    ).toBeInTheDocument();
    expect(within(linked).getByText(/Отстаёт от графика/)).toBeInTheDocument();
    expect(within(linked).queryByRole("button", { name: "Внести" })).toBeNull();
  });

  it("взнос в копилку: сумма уходит на сервер, внизу — «Отменить»", async () => {
    let body: unknown;
    server.use(
      overview(),
      http.post("*/api/budgets/goal/contribute", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ goal: vacation, undoToken: TOKEN });
      }),
    );
    renderPage();
    const piggy = await screen.findByRole("article", { name: "Отпуск" });
    await userEvent.click(within(piggy).getByRole("button", { name: "Внести" }));
    await userEvent.type(await screen.findByLabelText("Сумма взноса, BYN"), "200");
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Внести" }),
    );
    expect(await screen.findByText("Отложено 200 BYN на «Отпуск».")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отменить" })).toBeInTheDocument();
    expect(body).toEqual({ goalId: ID(3), amount: byn(20_000) });
  });

  it("новая цель: пока не введена сумма — подсказка, потом взнос от сервера", async () => {
    server.use(
      overview(),
      http.post("*/api/budgets/goal/preview", () =>
        HttpResponse.json({
          monthsLeft: 7,
          contribution: byn(42_900),
          fitsFreeBalance: true,
          freeBalance: byn(172_223),
        }),
      ),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Новая цель" }));
    expect(
      await screen.findByText("Введите сумму — посчитаю ежемесячный взнос"),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Название"), "Ноутбук");
    await userEvent.type(screen.getByLabelText("Сколько накопить, BYN"), "3000");
    await userEvent.type(screen.getByLabelText("К какому сроку"), "2027-06-01");
    expect(await screen.findByText("Откладывайте по 429,00 BYN в месяц")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Укладывается в свободный остаток 1 722,23 BYN"),
    ).toBeInTheDocument();
  });
});

describe("AGT-07: удаление лимита — только решением", () => {
  it("«Удалить» не удаляет: появляется вопрос «Да/Нет»; «Да» отправляет ответ", async () => {
    let answered: unknown;
    server.use(
      overview(),
      http.post("*/api/budgets/limit/delete", () => HttpResponse.json({ decisionId: ID(7) })),
      http.get("*/api/actions/decision", () =>
        HttpResponse.json({
          id: ID(7),
          status: "pending",
          summary: { key: "decisions.limitDelete", params: { category: "system:cafes" } },
          createdAt: "2026-10-28T09:00:00Z",
        }),
      ),
      http.post("*/api/actions/answer", async ({ request }) => {
        answered = await request.json();
        return HttpResponse.json({ status: "yes", undoToken: null });
      }),
    );
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Удалить лимит «Кафе, рестораны и доставка»" }),
    );
    expect(await screen.findByText(/Удалить этот лимит\?/)).toBeInTheDocument();
    expect(answered).toBeUndefined();
    await userEvent.click(
      screen.getByRole("button", { name: "Да, удалить лимит «Кафе, рестораны и доставка»" }),
    );
    await screen.findByRole("article", { name: "Такси" });
    expect(answered).toEqual({ id: ID(7), answer: "yes" });
  });
});
