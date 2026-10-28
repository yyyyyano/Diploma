// DES-16, STMT-01, STMT-02, STMT-09, EXPL-01, P5, AGT-07: «Счета» — четыре состояния; итоги в BYN с ⓘ (сохранённый
// расчёт → «Откуда эта цифра?»); нет курса — итог не показан и сказано почему; добавить и переименовать — сразу с
// «Отменить»; удалить — только «Да» в окне подтверждения.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { AccountsPage } from "./AccountsPage.tsx";

const TOKEN = "0199f0a0-0000-7000-8000-0000000000aa";
const TRACE = "0199f0a0-0000-7000-8000-0000000000bb";
const DECISION = "0199f0a0-0000-7000-8000-0000000000dd";

const cash = {
  id: "0190f0a0-0000-7000-8000-0000000000c1",
  kind: "cash",
  name: null,
  bank: null,
  mask: null,
  balance: { minor: 18_650, currency: "BYN" },
  balanceOn: "2026-10-28",
  balanceSource: "operations",
  initialBalance: { minor: 0, currency: "BYN" },
  balanceInByn: null,
  rate: null,
};

const usd = {
  ...cash,
  id: "0190f0a0-0000-7000-8000-0000000000c2",
  kind: "card",
  bank: "Альфа-Банк",
  mask: "2208",
  balance: { minor: 32_000, currency: "USD" },
  balanceSource: "manual",
  initialBalance: { minor: 32_000, currency: "USD" },
  balanceInByn: { minor: 95_587, currency: "BYN" },
  rate: { rateE4: 29_871, scale: 1, date: "2026-10-28" },
};

function list(items: readonly unknown[], totals?: unknown) {
  return http.get("*/api/accounts", () =>
    HttpResponse.json({
      onDate: "2026-10-28",
      items,
      totals: totals ?? {
        total: { minor: 18_650 + 95_587, currency: "BYN" },
        available: { minor: 18_650 + 95_587, currency: "BYN" },
        missingRates: [],
      },
    }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <AccountsPage />
    </QueryClientProvider>,
  );
}

describe("DES-16: состояния экрана «Счета»", () => {
  it("загрузка — скелетоны с «Загрузка…» для экранного диктора", async () => {
    server.use(
      http.get("*/api/accounts", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderPage();
    expect(await screen.findAllByText("Загрузка…")).not.toHaveLength(0);
  });

  it("успех — итоги, карточки и «Остатки на 28.10.2026 · 2 счёта»", async () => {
    server.use(list([cash, usd]));
    renderPage();
    expect(await screen.findByRole("article", { name: "Наличные" })).toHaveTextContent("186,50");
    expect(screen.getByText("Остатки на 28.10.2026 · 2 счёта")).toBeInTheDocument();
    expect(screen.getByText("Всего на счетах").parentElement?.parentElement).toHaveTextContent(
      /1\s142,37/,
    );
    expect(screen.getByRole("heading", { name: "Как Кошт считает остатки" })).toBeInTheDocument();
  });

  it("пусто — что здесь будет", async () => {
    server.use(
      list([], {
        total: { minor: 0, currency: "BYN" },
        available: { minor: 0, currency: "BYN" },
        missingRates: [],
      }),
    );
    renderPage();
    expect(await screen.findByRole("heading", { name: "Счетов пока нет" })).toBeInTheDocument();
  });

  it("ошибка — что случилось, а «Попробовать ещё раз» загружает снова", async () => {
    let fail = true;
    server.use(
      http.get("*/api/accounts", () =>
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
          : HttpResponse.json({
              onDate: "2026-10-28",
              items: [cash],
              totals: { total: cash.balance, available: cash.balance, missingRates: [] },
            }),
      ),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Не удалось загрузить счета" }),
    ).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Попробовать ещё раз" }));
    expect(await screen.findByRole("article", { name: "Наличные" })).toBeInTheDocument();
  });
});

describe("STMT-09, EXPL-01: итоги в BYN и «Откуда эта цифра?»", () => {
  it("ⓘ итога сохраняет расчёт и открывает панель с ним", async () => {
    const asked: unknown[] = [];
    server.use(
      list([cash, usd]),
      http.post("*/api/accounts/explain", async ({ request }) => {
        asked.push(await request.json());
        return HttpResponse.json({ traceId: TRACE });
      }),
      http.get("*/api/explain", () =>
        HttpResponse.json({
          id: TRACE,
          trace: {
            key: "accounts.total",
            op: "sum",
            value: { minor: 114_237, currency: "BYN" },
            inputs: [],
            refs: [{ kind: "fxRate", id: "fx-1" }],
          },
          period: { from: "2026-10-28", to: "2026-10-28" },
          createdAt: "2026-10-28T09:00:00Z",
        }),
      ),
    );
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Откуда эта цифра: всего на счетах" }),
    );
    expect(await screen.findByText("Курс НБРБ")).toBeInTheDocument();
    expect(asked).toEqual([{ subject: { kind: "total" } }]);
  });

  it("валюта без курса — итог «—» и почему; у счёта — «Курс НБРБ на сегодня недоступен»", async () => {
    server.use(
      list([cash, { ...usd, balanceInByn: null, rate: null }], {
        total: null,
        available: null,
        missingRates: ["USD"],
      }),
    );
    renderPage();
    expect(await screen.findAllByText(/Итог не показан: нет курса НБРБ для USD/)).toHaveLength(2);
    expect(screen.getByRole("article", { name: "Альфа-Банк •• 2208" })).toHaveTextContent(
      "Курс НБРБ на сегодня недоступен",
    );
    expect(
      screen.queryByRole("button", { name: "Откуда эта цифра: всего на счетах" }),
    ).not.toBeInTheDocument();
  });
});

describe("STMT-01, P5: добавить и переименовать — сразу с «Отменить»", () => {
  it("«Добавить счёт»: вклад в USD с начальным остатком 150,00 → create и тост с «Отменить»", async () => {
    const created: unknown[] = [];
    server.use(
      list([cash]),
      http.post("*/api/accounts", async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json({
          account: { ...usd, kind: "deposit", name: "Отпуск" },
          undoToken: TOKEN,
        });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Добавить счёт" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Вклад" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Название" }), "Отпуск");
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Валюта" }));
    await userEvent.click(await screen.findByRole("option", { name: "USD — доллар США" }));
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: /Начальный остаток/ }),
      "150,00",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Добавить счёт" }));
    expect(await screen.findByText("Добавил счёт «Отпуск»")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отменить" })).toBeInTheDocument();
    expect(created).toEqual([
      {
        kind: "deposit",
        name: "Отпуск",
        bank: null,
        mask: null,
        currency: "USD",
        initialBalance: { minor: 15_000, currency: "USD" },
      },
    ]);
  });

  it("меню счёта → «Переименовать» → rename и тост", async () => {
    const renamed: unknown[] = [];
    server.use(
      list([cash]),
      http.post("*/api/accounts/rename", async ({ request }) => {
        renamed.push(await request.json());
        return HttpResponse.json({ account: { ...cash, name: "Кошелёк" }, undoToken: TOKEN });
      }),
    );
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Действия со счётом «Наличные»" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Переименовать" }));
    const name = await screen.findByRole("textbox", { name: "Название счёта" });
    await userEvent.clear(name);
    await userEvent.type(name, "Кошелёк");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Переименовал: «Кошелёк»")).toBeInTheDocument();
    expect(renamed).toEqual([{ id: cash.id, name: "Кошелёк" }]);
  });

  it("«Наличные» в меню без «Удалить счёт» — сказано, что их удалить нельзя", async () => {
    server.use(list([cash]));
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Действия со счётом «Наличные»" }),
    );
    expect(await screen.findByText(/их нельзя удалить/)).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Удалить счёт" })).not.toBeInTheDocument();
  });
});

describe("AGT-07: удаление — только после «Да»", () => {
  it("«Удалить счёт» → решение с вопросом → «Да» отвечает на него", async () => {
    const answers: unknown[] = [];
    server.use(
      list([cash, usd]),
      http.post("*/api/accounts/delete", () => HttpResponse.json({ decisionId: DECISION })),
      http.get("*/api/actions/decision", () =>
        HttpResponse.json({
          id: DECISION,
          status: "pending",
          summary: { key: "decisions.accountDelete", params: { name: "Альфа-Банк •• 2208" } },
          createdAt: "2026-10-28T09:00:00Z",
        }),
      ),
      http.post("*/api/actions/answer", async ({ request }) => {
        answers.push(await request.json());
        return HttpResponse.json({ status: "yes" });
      }),
    );
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Действия со счётом «Альфа-Банк •• 2208»" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Удалить счёт" }));
    expect(await screen.findByText(/Удалить счёт «Альфа-Банк •• 2208»\?/)).toBeInTheDocument();
    expect(answers).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Да, выполнить" }));
    await screen.findByRole("article", { name: "Наличные" });
    expect(answers).toEqual([{ id: DECISION, answer: "yes" }]);
  });
});
