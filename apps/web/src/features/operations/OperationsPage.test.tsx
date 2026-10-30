// DES-16, TXN-01…05, STMT-09, P5, AGT-07: «Операции» — четыре состояния; строки (контрагент, категория, счёт, сумма,
// валюта и «курс не получен»); поиск, тип и страница — в адресе и в запросе; добавление и правка — сразу, с «Отменить»;
// карточка с источником категории, курсом и историей; удаление — только после «Да», затем «Отменить»; телефон — «Показать ещё».
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import {
  baseHandlers,
  CASH,
  coffee,
  DECISION,
  list,
  noRate,
  page,
  phone,
  renderPage,
  requests,
  steam,
  T1,
  T2,
  T3,
  TOKEN,
  TRACE,
  USD,
} from "./__fixtures__/harness.tsx";

describe("DES-16: состояния экрана «Операции»", () => {
  it("загрузка — скелетон с «Загрузка…» для экранного диктора", async () => {
    server.use(
      ...baseHandlers(),
      http.get("*/api/transactions", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderPage();
    expect(await screen.findAllByText("Загрузка…")).not.toHaveLength(0);
  });

  it("успех — «Найдено: 58 операций», строки таблицы и «Показано 3 из 58»", async () => {
    server.use(
      ...baseHandlers(),
      list(() => page([coffee, steam, noRate], 58)),
    );
    renderPage();
    expect(await screen.findByText("Найдено: 58 операций")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Операции" });
    const row = within(table).getByRole("row", { name: /Кофейня «Зерно»/ });
    expect(within(row).getByText("21.10.2026 08:47")).toBeInTheDocument();
    expect(within(row).getByText("Кафе, рестораны и доставка")).toBeInTheDocument();
    expect(within(row).getByText("Наличные")).toBeInTheDocument();
    expect(within(row).getByText(/−6,50/)).toBeInTheDocument();
    expect(within(row).getByText("Из чата: «кофе 6,50 наличными»")).toBeInTheDocument();
    expect(screen.getByText("Показано 3 из 58")).toBeInTheDocument();
  });

  it("STMT-09: валюта — сумма в BYN и исходная под ней; курса нет — исходная сумма и «курс не получен»", async () => {
    server.use(
      ...baseHandlers(),
      list(() => page([steam, noRate])),
    );
    renderPage();
    const rows = await screen.findAllByRole("row");
    const steamRow = rows.find((row) => within(row).queryByText("Steam") !== null);
    expect(within(steamRow as HTMLElement).getByText(/−29,84/)).toBeInTheDocument();
    expect(within(steamRow as HTMLElement).getByText(/9,99/)).toBeInTheDocument();
    const wbRow = rows.find((row) => within(row).queryByText("Wildberries") !== null);
    expect(within(wbRow as HTMLElement).getByText("курс не получен")).toBeInTheDocument();
  });

  it("пусто без фильтров — «Операций пока нет» и «Добавить операцию»", async () => {
    server.use(
      ...baseHandlers(),
      list(() => page([])),
    );
    renderPage();
    expect(await screen.findByText("Операций пока нет")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Добавить операцию" })).not.toHaveLength(0);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("пусто под фильтром — «Ничего не нашлось», «Сбросить фильтры» очищает адрес", async () => {
    server.use(
      ...baseHandlers(),
      list((url) => (url.searchParams.has("type") ? page([]) : page([coffee]))),
    );
    renderPage("/operations?type=income");
    expect(await screen.findByText("Ничего не нашлось")).toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Сбросить фильтры" })[0] as HTMLElement,
    );
    expect(await screen.findByText("Кофейня «Зерно»")).toBeInTheDocument();
    expect(requests.at(-1)?.searchParams.has("type")).toBe(false);
  });

  it("ошибка — «Операции не загрузились» и «Повторить»", async () => {
    let calls = 0;
    server.use(
      ...baseHandlers(),
      http.get("*/api/transactions", () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json(page([coffee]));
      }),
    );
    renderPage();
    expect(await screen.findByText("Операции не загрузились")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Кофейня «Зерно»")).toBeInTheDocument();
  });
});

describe("TXN-02: поиск, тип и страница — в адресе и в запросе", () => {
  it("адрес /operations?type=expense&page=2&q=кофе уходит в запрос списка", async () => {
    server.use(
      ...baseHandlers(),
      list(() => page([coffee], 120, 2)),
    );
    renderPage("/operations?type=expense&page=2&q=%D0%BA%D0%BE%D1%84%D0%B5");
    await screen.findByText("Кофейня «Зерно»");
    const params = requests.at(-1)?.searchParams;
    expect(params?.get("type")).toBe("expense");
    expect(params?.get("page")).toBe("2");
    expect(params?.get("query")).toBe("кофе");
    expect(params?.get("pageSize")).toBe("50");
  });

  it("тип «Доходы» — новый запрос с type=income, страница сбрасывается", async () => {
    server.use(
      ...baseHandlers(),
      list(() => page([coffee], 120)),
    );
    const { router } = renderPage("/operations?page=3");
    await screen.findByText("Кофейня «Зерно»");
    await userEvent.click(screen.getByRole("radio", { name: "Доходы" }));
    await expect.poll(() => requests.at(-1)?.searchParams.get("type")).toBe("income");
    expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
    expect(router.state.location.search).toMatchObject({ type: "income" });
  });

  it("поиск: набранный текст через паузу попадает в адрес и в запрос", async () => {
    server.use(
      ...baseHandlers(),
      list(() => page([coffee])),
    );
    const { router } = renderPage();
    await screen.findByText("Кофейня «Зерно»");
    await userEvent.type(screen.getByRole("textbox", { name: "Поиск по операциям" }), "зерно");
    await expect.poll(() => requests.at(-1)?.searchParams.get("query")).toBe("зерно");
    expect(router.state.location.search).toMatchObject({ q: "зерно" });
  });

  it("страница 2 в нумерации — запрос page=2", async () => {
    server.use(
      ...baseHandlers(),
      list((url) => page([coffee], 120, Number(url.searchParams.get("page")))),
    );
    renderPage();
    await screen.findByText("Показано 1 из 120");
    await userEvent.click(screen.getByRole("button", { name: "Страница 2" }));
    await expect.poll(() => requests.at(-1)?.searchParams.get("page")).toBe("2");
  });
});

describe("TXN-02: телефон — «Показать ещё» без таблицы", () => {
  it("список карточек и «Показать ещё» подгружает следующую страницу", async () => {
    phone();
    server.use(
      ...baseHandlers(),
      list((url) =>
        url.searchParams.get("page") === "2" ? page([steam], 51, 2) : page([coffee], 51, 1),
      ),
    );
    renderPage();
    expect(await screen.findByText("Показано 1 из 51")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(await screen.findByText("Показано 2 из 51")).toBeInTheDocument();
    expect(screen.getByText("Steam")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Показать ещё" })).toBeNull();
  });
});

describe("TXN-03, P5: добавление и правка — сразу, с «Отменить»", () => {
  it("«Добавить операцию»: сумма и контрагент уходят в create, на экране «Записал…» с «Отменить»", async () => {
    let body: unknown;
    server.use(
      ...baseHandlers(),
      list(() => page([coffee])),
      http.post("*/api/transactions", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ transaction: coffee, undoToken: TOKEN });
      }),
    );
    renderPage();
    await screen.findByText("Кофейня «Зерно»");
    await userEvent.click(
      screen.getAllByRole("button", { name: "Добавить операцию" })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog", { name: "Новая операция" });
    await userEvent.type(within(dialog).getByLabelText("Сумма, BYN"), "6,50");
    await userEvent.type(within(dialog).getByLabelText("Контрагент"), "Кофейня «Зерно»");
    await userEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText(/Записал: Кофейня «Зерно»/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отменить" })).toBeInTheDocument();
    expect(body).toMatchObject({
      type: "expense",
      accountId: CASH,
      occurredOn: "2026-10-28",
      amount: { minor: 650, currency: "BYN" },
      merchant: "Кофейня «Зерно»",
      category: null,
    });
  });

  it("сумма «0» или текст — кнопка «Сохранить» неактивна и сказано почему", async () => {
    server.use(
      ...baseHandlers(),
      list(() => page([coffee])),
    );
    renderPage();
    await screen.findByText("Кофейня «Зерно»");
    await userEvent.click(
      screen.getAllByRole("button", { name: "Добавить операцию" })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog", { name: "Новая операция" });
    await userEvent.type(within(dialog).getByLabelText("Сумма, BYN"), "0");
    expect(within(dialog).getByText("Укажите сумму больше нуля")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Сохранить" })).toBeDisabled();
  });

  it("«Отменить» шлёт undoToken в actions.undo", async () => {
    let undone: unknown;
    server.use(
      ...baseHandlers(),
      list(() => page([coffee])),
      http.post("*/api/transactions", () =>
        HttpResponse.json({ transaction: coffee, undoToken: TOKEN }),
      ),
      http.post("*/api/actions/undo", async ({ request }) => {
        undone = await request.json();
        return HttpResponse.json({ status: "undone" });
      }),
    );
    renderPage();
    await screen.findByText("Кофейня «Зерно»");
    await userEvent.click(
      screen.getAllByRole("button", { name: "Добавить операцию" })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog", { name: "Новая операция" });
    await userEvent.type(within(dialog).getByLabelText("Сумма, BYN"), "6,50");
    await userEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await userEvent.click(await screen.findByRole("button", { name: "Отменить" }));
    await expect.poll(() => undone).toEqual({ token: TOKEN });
  });
});

describe("TXN-05: карточка операции", () => {
  const card = (transaction: object, rate: object | null = null) =>
    http.get("*/api/transactions/item", () =>
      HttpResponse.json({
        transaction,
        rate,
        history: [
          { at: "2026-10-21T05:47:00.000Z", action: "created", channel: "web", fields: [] },
        ],
      }),
    );

  it("поля, исходное описание, источник категории и история; правка суммы шлёт только изменённое", async () => {
    let body: unknown;
    server.use(
      ...baseHandlers(),
      list(() => page([coffee])),
      card(coffee),
      http.post("*/api/transactions/update", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ transaction: coffee, undoToken: TOKEN, applyToPast: null });
      }),
    );
    renderPage(`/operations?op=${T1}`);
    const panel = await screen.findByRole("dialog", { name: "Операция" });
    expect(await within(panel).findByText("Из чата: «кофе 6,50 наличными»")).toBeInTheDocument();
    expect(within(panel).getByText("Сообщение ассистенту")).toBeInTheDocument();
    expect(within(panel).getByText("Категория — выбрана вами")).toBeInTheDocument();
    expect(within(panel).getByText("История изменений")).toBeInTheDocument();
    expect(within(panel).getByText(/Записана на сайте/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Изменить" }));
    const form = await screen.findByRole("dialog", { name: "Изменить операцию" });
    const amount = within(form).getByLabelText("Сумма, BYN");
    await userEvent.clear(amount);
    await userEvent.type(amount, "8");
    await userEvent.click(within(form).getByRole("button", { name: "Сохранить" }));
    await expect
      .poll(() => body)
      .toEqual({
        id: T1,
        expectedVersion: 1,
        patch: { amount: { minor: 800, currency: "BYN" } },
      });
    expect(await screen.findByText(/Изменил операцию/)).toBeInTheDocument();
  });

  it("STMT-09: у валютной операции — курс НБРБ и ⓘ «Откуда курс?» сохраняет расчёт и открывает панель", async () => {
    let explained: unknown;
    server.use(
      ...baseHandlers(),
      list(() => page([steam])),
      card(steam, { rateE4: 29_871, scale: 1, date: "2026-10-05" }),
      http.post("*/api/transactions/explain-rate", async ({ request }) => {
        explained = await request.json();
        return HttpResponse.json({ traceId: TRACE });
      }),
      http.get("*/api/explain", () =>
        HttpResponse.json({
          id: TRACE,
          trace: { op: "value", key: "fx.rate", refs: [], value: 29_871, inputs: [] },
          period: null,
          createdAt: "2026-10-05T00:00:00.000Z",
        }),
      ),
    );
    renderPage(`/operations?op=${T2}`);
    const panel = await screen.findByRole("dialog", { name: "Операция" });
    expect(
      await within(panel).findByText(/Курс НБРБ на 05.10.2026: 2,9871 BYN за 1/),
    ).toBeInTheDocument();
    await userEvent.click(
      within(panel).getByRole("button", { name: "Откуда эта цифра: курс НБРБ" }),
    );
    await expect.poll(() => explained).toEqual({ id: T2 });
  });

  it("STMT-10: операция из выписки — «Загружено из файла» ведёт к импорту, «Исходный файл» — к файлу", async () => {
    const importId = "0199f0a0-0000-7000-8000-0000000000e1";
    const fileId = "0199f0a0-0000-7000-8000-0000000000f1";
    const imported = { ...steam, importId };
    server.use(
      ...baseHandlers(),
      list(() => page([imported])),
      card(imported, { rateE4: 29_871, scale: 1, date: "2026-10-05" }),
      http.get(`*/api/statements/imports/${importId}`, () =>
        HttpResponse.json({
          summary: {
            id: importId,
            fileId,
            status: "imported",
            bank: "Альфа-Банк",
            mask: "2208",
            currency: "USD",
            period: { from: "2026-10-01", to: "2026-10-20" },
            found: 12,
            newCount: 12,
            duplicates: 0,
            doubtful: 0,
            skipped: 0,
            method: "detected",
            formatChanged: false,
            balance: null,
            warnings: [],
            errorCode: null,
            accountId: USD,
            createdAt: "2026-10-20T18:00:00.000Z",
            importedAt: "2026-10-20T18:01:00.000Z",
          },
          rows: [],
          columns: null,
        }),
      ),
    );
    renderPage(`/operations?op=${T2}`);
    const panel = await screen.findByRole("dialog", { name: "Операция" });
    const statement = await within(panel).findByRole("link", {
      name: /Загружено из файла.*Выписка Альфа-Банк •• 2208 за 01.10.2026–20.10.2026/,
    });
    expect(statement).toHaveAttribute("href", `/documents?import=${importId}`);
    expect(within(panel).getByRole("link", { name: "Исходный файл" })).toHaveAttribute(
      "href",
      `/api/files/${fileId}`,
    );
  });

  it("операция не из выписки — ссылок на импорт и файл нет", async () => {
    server.use(
      ...baseHandlers(),
      list(() => page([coffee])),
      card(coffee),
    );
    renderPage(`/operations?op=${T1}`);
    const panel = await screen.findByRole("dialog", { name: "Операция" });
    expect(await within(panel).findByText("История изменений")).toBeInTheDocument();
    expect(within(panel).queryByText("Загружено из файла")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("link", { name: "Исходный файл" })).not.toBeInTheDocument();
  });

  it("валютная операция без курса — «курс НБРБ пока не получен» вместо выдуманной суммы", async () => {
    server.use(
      ...baseHandlers(),
      list(() => page([noRate])),
      card(noRate),
    );
    renderPage(`/operations?op=${T3}`);
    const panel = await screen.findByRole("dialog", { name: "Операция" });
    expect(await within(panel).findByText(/Курс НБРБ пока не получен/)).toBeInTheDocument();
  });
});

describe("AGT-07, TXN-03: удаление — после «Да», затем «Отменить»", () => {
  it("«Удалить» → вопрос → «Да» → карточка закрыта, «Операция удалена» с «Отменить»; undoToken — в actions.undo", async () => {
    let asked: unknown;
    let undone: unknown;
    server.use(
      ...baseHandlers(),
      list(() => page([coffee])),
      http.get("*/api/transactions/item", () =>
        HttpResponse.json({ transaction: coffee, rate: null, history: [] }),
      ),
      http.post("*/api/transactions/delete", async ({ request }) => {
        asked = await request.json();
        return HttpResponse.json({ decisionId: DECISION });
      }),
      http.get("*/api/actions/decision", () =>
        HttpResponse.json({
          id: DECISION,
          status: "pending",
          summary: {
            key: "decisions.transactionsDelete",
            params: { count: 1, examples: "Кофейня «Зерно» 6,50 BYN" },
          },
          createdAt: "2026-10-28T09:00:00.000Z",
        }),
      ),
      http.post("*/api/actions/answer", () =>
        HttpResponse.json({ status: "yes", undoToken: TOKEN }),
      ),
      http.post("*/api/actions/undo", async ({ request }) => {
        undone = await request.json();
        return HttpResponse.json({ status: "undone" });
      }),
    );
    const { router } = renderPage(`/operations?op=${T1}`);
    const panel = await screen.findByRole("dialog", { name: "Операция" });
    await userEvent.click(await within(panel).findByRole("button", { name: "Удалить" }));
    await expect.poll(() => asked).toEqual({ ids: [T1] });
    expect(
      await screen.findByText(/Удалить операцию «Кофейня «Зерно» 6,50 BYN»\?/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Да, выполнить" }));
    expect(await screen.findByText("Операция удалена: Кофейня «Зерно».")).toBeInTheDocument();
    await expect.poll(() => router.state.location.search).not.toHaveProperty("op");
    await userEvent.click(screen.getByRole("button", { name: "Отменить" }));
    await expect.poll(() => undone).toEqual({ token: TOKEN });
  });
});
