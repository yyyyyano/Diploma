// DES-16, STMT-04, STMT-07, STMT-11, P5: «Чеки и документы» — пусто, ошибка, предпросмотр импорта («Нашёл 47 операций по
// карте •• 4821 за 01.09–30.09. 12 из них уже были загружены»), «Импортировать 35», «Исправить колонки» (роли колонок →
// повторный разбор), откат с подтверждением, где названо число правленных вручную.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { DocumentsPage } from "./DocumentsPage.tsx";

const ID = "0199f0a0-0000-7000-8000-000000000a01";
const TOKEN = "0199f0a0-0000-7000-8000-000000000a02";

const summary = {
  id: ID,
  fileId: "0199f0a0-0000-7000-8000-000000000a03",
  status: "ready",
  bank: "Лесбанк",
  mask: "4821",
  currency: "BYN",
  period: { from: "2026-09-01", to: "2026-09-30" },
  found: 47,
  newCount: 35,
  duplicates: 12,
  doubtful: 0,
  skipped: 0,
  method: "detected",
  formatChanged: false,
  balance: { status: "ok", difference: null },
  warnings: [],
  errorCode: null,
  accountId: null,
  createdAt: "2026-10-28T09:00:00.000Z",
  importedAt: null,
};

const detail = {
  summary,
  rows: [
    {
      date: "2026-09-01",
      time: null,
      amount: { minor: -1_914, currency: "BYN" },
      description: "EVROTORG T-0042 MINSK UL. VESNOVAYA 12",
      merchantName: "Евроопт",
      category: { type: "system", code: "groceries" },
      kind: "expense",
      duplicate: false,
      doubtful: false,
    },
    {
      date: "2026-09-02",
      time: null,
      amount: { minor: -20_000, currency: "BYN" },
      description: "Снятие наличных ATM 55",
      merchantName: null,
      category: null,
      kind: "transfer",
      duplicate: true,
      doubtful: false,
    },
  ],
  columns: {
    header: ["Дата", "Описание", "Сумма"],
    rows: [["01.09.2026", "EVROTORG", "-19,14"]],
    roles: ["date", "description", "amount"],
  },
};

function mock(items: readonly unknown[], current: object = detail) {
  server.use(
    http.get("*/api/statements/imports", () => HttpResponse.json({ items })),
    http.get("*/api/statements/imports/:id", () => HttpResponse.json(current)),
  );
}

function renderPage(search: { import?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <DocumentsPage search={search} />
    </QueryClientProvider>,
  );
}

describe("DES-16: состояния экрана «Чеки и документы»", () => {
  it("пусто — что здесь будет и кнопка загрузки", async () => {
    mock([]);
    renderPage();
    expect(await screen.findByRole("heading", { name: "Выписок пока нет" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Загрузить выписку" })).toBeInTheDocument();
  });

  it("ошибка списка — что случилось, «Попробовать ещё раз»", async () => {
    server.use(
      http.get("*/api/statements/imports", () =>
        HttpResponse.json(
          {
            defined: false,
            code: "INTERNAL",
            status: 500,
            message: "INTERNAL",
            data: { requestId: "r", params: {} },
          },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Не получилось загрузить список" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Попробовать ещё раз" })).toBeInTheDocument();
  });

  it("список выписок: банк и карта, статус, период, сколько найдено", async () => {
    mock([summary]);
    renderPage();
    const item = await screen.findByRole("heading", { name: "Лесбанк •• 4821" });
    expect(item.closest("li")).toHaveTextContent("Готова к импорту");
    expect(item.closest("li")).toHaveTextContent("за 01.09.2026–30.09.2026");
    expect(item.closest("li")).toHaveTextContent("найдено 47 операций");
  });
});

describe("STMT-10: импорт по ссылке из карточки операции", () => {
  it("адрес ?import=<id> сразу открывает этот импорт", async () => {
    mock([summary]);
    renderPage({ import: ID });
    expect(await screen.findByRole("region", { name: "Предпросмотр импорта" })).toHaveTextContent(
      "Нашёл 47 операций по карте •• 4821",
    );
  });
});

describe("STMT-04, STMT-07: предпросмотр импорта", () => {
  it("«Нашёл 47 операций по карте •• 4821 за … 12 из них уже были загружены», строки и «Импортировать 35»", async () => {
    mock([summary]);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Открыть предпросмотр" }));
    const panel = await screen.findByRole("region", { name: "Предпросмотр импорта" });
    expect(panel).toHaveTextContent(
      "Нашёл 47 операций по карте •• 4821 за 01.09.2026–30.09.2026. 12 из них уже были загружены.",
    );
    expect(within(panel).getByText("Остатки сходятся.")).toBeInTheDocument();
    // Макет statement-preview: плашки итогов и обещание STMT-10 про исходный файл.
    expect(within(panel).getByText("Новых: 35")).toBeInTheDocument();
    expect(within(panel).getByText("Уже были: 12")).toBeInTheDocument();
    expect(within(panel).getByText("Ошибок: 0")).toBeInTheDocument();
    expect(
      within(panel).getByText(
        "Исходный файл сохранится — его можно будет открыть из любой операции.",
      ),
    ).toBeInTheDocument();
    // Сырое описание → контрагент → категория; дубль и перевод помечены.
    expect(within(panel).getByText(/EVROTORG T-0042/)).toBeInTheDocument();
    expect(within(panel).getByText("Евроопт")).toBeInTheDocument();
    expect(within(panel).getByText("Уже загружена")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Импортировать 35" })).toBeEnabled();
    expect(within(panel).getByRole("button", { name: "Исправить колонки" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Отмена" })).toBeInTheDocument();
  });

  it("расхождение остатков — «проверьте» с суммой; ничего нового — импорт недоступен", async () => {
    const mismatch = {
      ...detail,
      summary: {
        ...summary,
        newCount: 0,
        duplicates: 47,
        balance: { status: "mismatch", difference: { minor: -3_333, currency: "BYN" } },
      },
    };
    mock([mismatch.summary], mismatch);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Открыть предпросмотр" }));
    const panel = await screen.findByRole("region", { name: "Предпросмотр импорта" });
    expect(panel).toHaveTextContent(/Остатки не сходятся: расхождение/);
    expect(panel).toHaveTextContent("Новых операций нет");
    expect(within(panel).getByRole("button", { name: "Импортировать 0" })).toBeDisabled();
  });

  it("«Импортировать 35» отправляет подтверждение и показывает «Отменить»", async () => {
    mock([summary]);
    let confirmed = 0;
    server.use(
      http.post("*/api/statements/imports/:id/confirm", () => {
        confirmed += 1;
        return HttpResponse.json({
          imported: 35,
          duplicates: 12,
          undoToken: TOKEN,
          decisionId: null,
        });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Открыть предпросмотр" }));
    await userEvent.click(await screen.findByRole("button", { name: "Импортировать 35" }));
    expect(await screen.findByText("Импортировано 35 операций.")).toBeInTheDocument();
    expect(confirmed).toBe(1);
  });

  it("«Исправить колонки»: роли каждой колонки уходят на сервер, разбор идёт заново", async () => {
    mock([summary]);
    let sent: unknown;
    server.use(
      http.post("*/api/statements/imports/:id/columns", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ id: ID });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Открыть предпросмотр" }));
    await userEvent.click(await screen.findByRole("button", { name: "Исправить колонки" }));
    const dialog = await screen.findByRole("dialog", { name: "Исправить колонки" });
    await userEvent.selectOptions(within(dialog).getByLabelText("Колонка 3"), "debit");
    await userEvent.click(within(dialog).getByRole("button", { name: "Разобрать заново" }));
    // id — в пути запроса, в теле — только роли колонок.
    expect(sent).toEqual({
      columns: [
        { index: 0, role: "date" },
        { index: 1, role: "description" },
        { index: 2, role: "debit" },
      ],
    });
  });
});

describe("STMT-11: откат импорта", () => {
  it("подтверждение называет число операций и сколько из них правили вручную; «Откатить» отправляет откат", async () => {
    const imported = {
      ...detail,
      summary: { ...summary, status: "imported", importedAt: "2026-10-28T10:00:00.000Z" },
      columns: null,
    };
    mock([imported.summary], imported);
    let rolled = 0;
    server.use(
      http.get("*/api/statements/imports/:id/rollback", () =>
        HttpResponse.json({ transactions: 35, edited: 2 }),
      ),
      http.post("*/api/statements/imports/:id/rollback", () => {
        rolled += 1;
        return HttpResponse.json({ status: "undone" });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Открыть предпросмотр" }));
    await userEvent.click(await screen.findByRole("button", { name: "Откатить импорт" }));
    const dialog = await screen.findByRole("dialog", { name: "Откатить импорт?" });
    expect(dialog).toHaveTextContent("Будут удалены 35 операций");
    expect(dialog).toHaveTextContent("2 операции вы правили вручную — они тоже удалятся.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Откатить" }));
    expect(await screen.findByText("Импорт откатан.")).toBeInTheDocument();
    expect(rolled).toBe(1);
  });
});
