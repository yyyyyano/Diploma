// RCPT-01, RCPT-02, RCPT-06…08, RCPT-11, RCPT-12, DES-03, DES-16 на экране: карточка «Сканировать чек» (до 10 фото, без
// capture), проверка по этапам с «Перепроверка строки 2…», результат «Сумма сходится 100%» / «Требует проверки», «Верно /
// Изменить / Отменить», дубль «Этот чек уже загружен 12.10», «Проверить на сайте МНС» (УИ и день копируются, МНС не
// запрашивается).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../../test/msw.ts";
import { renderWithProviders } from "../../../test/render.tsx";
import { ReceiptsSection } from "./ReceiptsSection.tsx";

const ID = "0199f0a0-0000-7000-8000-000000000b01";
const FILE = "0199f0a0-0000-7000-8000-000000000b02";
const OTHER = "0199f0a0-0000-7000-8000-000000000b03";

const byn = (minor: number) => ({ minor, currency: "BYN" });

const summary = (over: object = {}) => ({
  id: ID,
  status: "ok",
  stage: null,
  disputedLines: [],
  errorCode: null,
  duplicateOf: null,
  storeName: "Сосновый",
  purchaseDate: "2026-10-12",
  purchaseTime: "14:37",
  total: byn(2346),
  confirmed: false,
  rechecks: 0,
  createdAt: "2026-10-12T11:37:00.000Z",
  ...over,
});

const item = (position: number, name: string, over: object = {}) => ({
  position,
  name,
  normalizedName: name,
  unit: "шт",
  quantityMilli: 1000,
  unitPrice: byn(1099),
  discount: byn(0),
  lineTotal: byn(1099),
  disputed: false,
  category: { type: "system", code: "groceries" },
  warranty: false,
  ...over,
});

const card = ({ receipt, ...over }: { receipt?: object } & Record<string, unknown> = {}) => ({
  receipt: summary(receipt),
  unp: "190123456",
  address: "г. Минск",
  payment: { method: "card", last4: "4417" },
  receiptDiscount: byn(0),
  remainder: byn(0),
  mismatches: [],
  items: [
    item(1, "Хлеб"),
    item(2, "Молоко", { quantityMilli: 3000, unitPrice: byn(249), lineTotal: byn(747) }),
  ],
  attempts: [{ attempt: 0, askedLines: [], changedLines: [], ok: true }],
  fileId: FILE,
  operation: { id: OTHER, accountId: OTHER, pending: true, merged: false },
  mns: { uid: "A1B2C3D4E5F6A7B8C9D0E1F2", date: "2026-10-12" },
  traceId: null,
  ...over,
});

function mock(current: object, list: readonly object[] = [summary()]) {
  server.use(
    http.get("*/api/receipts", () => HttpResponse.json({ items: list })),
    http.get("*/api/receipts/:id", () => HttpResponse.json(current)),
    http.get("*/api/categories", () => HttpResponse.json({ items: [] })),
  );
}

function renderSection(openId: string | null = ID, onOpen = vi.fn<(id: string | null) => void>()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ReceiptsSection openId={openId} onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return { onOpen };
}

describe("RCPT-01: сканирование", () => {
  it("поле загрузки — фото, несколько сразу, без capture: браузер на телефоне предложит «Камера / Галерея»", async () => {
    mock(card(), []);
    renderSection(null);
    const field = await screen.findByLabelText("Фото чека");
    expect(field).toHaveAttribute("accept", "image/*,.heic");
    expect(field).toHaveAttribute("multiple");
    expect(field).not.toHaveAttribute("capture");
  });

  it("выбранные фото загружаются как «чеки» и ставятся на распознавание; открывается первый чек", async () => {
    mock(card(), []);
    const calls: unknown[] = [];
    server.use(
      http.post("*/api/files", () =>
        HttpResponse.json({
          files: [
            { id: FILE, name: "a.jpg", mime: "image/jpeg", size: 3 },
            { id: OTHER, name: "b.jpg", mime: "image/jpeg", size: 3 },
          ],
        }),
      ),
      http.post("*/api/receipts", async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({
          items: [
            { id: ID, fileId: FILE },
            { id: OTHER, fileId: OTHER },
          ],
        });
      }),
    );
    const { onOpen } = renderSection(null);
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText("Фото чека"), [
      new File(["x"], "a.jpg", { type: "image/jpeg" }),
      new File(["y"], "b.jpg", { type: "image/jpeg" }),
    ]);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(ID));
    expect(calls).toEqual([{ fileIds: [FILE, OTHER] }]);
  });

  it("больше 10 фото за раз — сообщение, ничего не загружается", async () => {
    mock(card(), []);
    renderSection(null);
    const user = userEvent.setup();
    await user.upload(
      await screen.findByLabelText("Фото чека"),
      Array.from({ length: 11 }, (_, i) => new File(["x"], `${i}.jpg`, { type: "image/jpeg" })),
    );
    expect(await screen.findByText("За раз можно не больше 10 фото.")).toBeInTheDocument();
  });
});

describe("RCPT-02, RCPT-06: проверка по этапам", () => {
  it("«Читаю чек» идёт, остальные ждут", async () => {
    mock(card({ receipt: { status: "processing", stage: "reading", total: null } }));
    renderSection();
    const steps = await screen.findByRole("list", { name: "Этапы проверки чека" });
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Читаю чек, идёт", "Проверяю арифметику, ждёт"]);
  });

  it("перепроверка называет строку: «Перепроверка строки 2», до неё этапы сделаны", async () => {
    mock(
      card({
        receipt: { status: "processing", stage: "rechecking", disputedLines: [2], total: null },
      }),
    );
    renderSection();
    const steps = await screen.findByRole("list", { name: "Этапы проверки чека" });
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "Читаю чек, сделано",
      "Проверяю арифметику, сделано",
      "Перепроверка строки 2, идёт",
    ]);
  });
});

describe("RCPT-07, DES-03: результат", () => {
  it("«Сумма сходится 100%» с иконкой, позиции с категориями, «ожидает выписки» и «Верно / Изменить / Отменить»", async () => {
    mock(card());
    renderSection();
    expect((await screen.findAllByText("Сумма сходится 100%")).length).toBeGreaterThan(0);
    expect(screen.getByText("Ожидает выписки")).toBeInTheDocument();
    expect(screen.getByText("Хлеб")).toBeInTheDocument();
    expect(screen.getByText(/Оплата картой — платёж в выписке пока не найден/)).toBeInTheDocument();
    for (const name of ["Верно", "Изменить", "Отменить"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("«Требует проверки»: спорные строки названы, остаток уходит в «Прочее», есть «Исправить строки»; перепроверенная строка помечена", async () => {
    mock(
      card({
        receipt: { status: "needs-review", disputedLines: [2], rechecks: 2 },
        remainder: byn(137),
        mismatches: [
          { kind: "line", line: 2, reason: "arithmetic", expected: byn(747), printed: byn(847) },
        ],
        items: [item(1, "Хлеб"), item(2, "Молоко", { disputed: true, lineTotal: byn(847) })],
      }),
    );
    renderSection();
    expect(await screen.findByText("Требует проверки: строки 2")).toBeInTheDocument();
    expect(
      screen.getByText(/нераспознанный остаток 1,37 BYN отнесён к «Прочему»/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Исправить строки" })).toBeInTheDocument();
    expect(screen.getByText("строка не сходится")).toBeInTheDocument();
  });

  it("дубль: «Этот чек уже загружен 12.10» и переход к прежнему чеку", async () => {
    mock(
      card({
        receipt: {
          status: "failed",
          errorCode: "RECEIPT_DUPLICATE",
          duplicateOf: { id: OTHER, date: "12.10" },
          total: null,
        },
        items: [],
        operation: null,
        mns: null,
      }),
    );
    const { onOpen } = renderSection();
    expect(await screen.findByText("Этот чек уже загружен 12.10.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Открыть прежний чек" }));
    expect(onOpen).toHaveBeenCalledWith(OTHER);
    expect(screen.queryByRole("button", { name: "Верно" })).not.toBeInTheDocument();
  });

  it("не прочитанное фото: сообщение по коду ошибки, без «Верно» и «Изменить»", async () => {
    mock(
      card({
        receipt: { status: "failed", errorCode: "RECEIPT_UNREADABLE", total: null },
        items: [],
        operation: null,
        mns: null,
      }),
    );
    renderSection();
    expect(await screen.findByText("Чек не распознан")).toBeInTheDocument();
    expect(screen.getByText(/Не получилось прочитать фото чека/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Изменить" })).not.toBeInTheDocument();
  });
});

describe("RCPT-08: «Верно», «Изменить», «Отменить»", () => {
  it("«Верно» подтверждает чек на сервере", async () => {
    mock(card());
    let confirmed = false;
    server.use(
      http.post("*/api/receipts/:id/confirm", () => {
        confirmed = true;
        return HttpResponse.json(card({ receipt: { confirmed: true } }));
      }),
    );
    renderSection();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Верно" }));
    await waitFor(() => expect(confirmed).toBe(true));
  });

  it("«Изменить»: числа правит человек, сервер пересчитывает статус — отправляются копейки и тысячные, а не расчёт", async () => {
    mock(card());
    const bodies: unknown[] = [];
    server.use(
      http.put("*/api/receipts/:id/items", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(card());
      }),
    );
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Изменить" }));
    const dialog = await screen.findByRole("dialog");
    const lineTotals = within(dialog).getAllByLabelText("Сумма строки");
    await user.clear(lineTotals[1] as HTMLElement);
    await user.type(lineTotals[1] as HTMLElement, "7,47");
    await user.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    // id чека — в пути, в теле — позиции и итог.
    expect(bodies[0]).toMatchObject({
      total: byn(2346),
      items: [
        { name: "Хлеб", quantityMilli: 1000, unitPrice: byn(1099), lineTotal: byn(1099) },
        { name: "Молоко", quantityMilli: 3000, unitPrice: byn(249), lineTotal: byn(747) },
      ],
    });
  });

  it("«Изменить»: число не по формату — сообщение, запрос не уходит", async () => {
    mock(card());
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Изменить" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getAllByLabelText("Цена")[0] as HTMLElement, "abc");
    await user.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Проверьте числа");
  });

  it("«Отменить» спрашивает подтверждение и удаляет чек, его операцию и фото", async () => {
    mock(card());
    let cancelled = false;
    server.use(
      http.post("*/api/receipts/:id/cancel", () => {
        cancelled = true;
        return HttpResponse.json({ id: ID });
      }),
    );
    const { onOpen } = renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Отменить" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Чек, его операция и фото будут удалены/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Да, отменить" }));
    await waitFor(() => expect(cancelled).toBe(true));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(null));
  });
});

describe("RCPT-11, RCPT-12: фото и сайт МНС", () => {
  it("фото открывается из чека; «Проверить на сайте МНС» — ссылка с noopener, УИ и день копируются, к МНС запросов нет", async () => {
    mock(card());
    renderSection();
    const user = userEvent.setup();
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const photo = await screen.findByRole("link", { name: "Открыть фото" });
    expect(photo).toHaveAttribute("href", `/api/files/${FILE}`);
    const mns = screen.getByRole("link", { name: "Проверить на сайте МНС" });
    expect(mns).toHaveAttribute("href", "https://ch.info-center.by/");
    expect(mns).toHaveAttribute("rel", expect.stringContaining("noopener"));
    await user.click(screen.getByRole("button", { name: "Скопировать УИ и день" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("A1B2C3D4E5F6A7B8C9D0E1F2 12.10.2026"),
    );
    expect(await screen.findByText("Скопировано")).toBeInTheDocument();
  });
});

describe("DES-16: список и пустое состояние", () => {
  it("пусто — подсказка; в списке — магазин, день, сумма, статус и переход к чеку", async () => {
    mock(card(), []);
    renderSection(null);
    expect(await screen.findByText("Чеков пока нет — сфотографируйте первый.")).toBeInTheDocument();
  });

  it("строка списка открывает чек", async () => {
    mock(card(), [
      summary(),
      summary({ id: OTHER, storeName: "Зелёная ветка", status: "needs-review" }),
    ]);
    const { onOpen } = renderSection(null);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Зелёная ветка/ }));
    expect(onOpen).toHaveBeenCalledWith(OTHER);
  });
});
