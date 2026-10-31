// ADM-11, TAX-03, LAW-33: «Таблица ставок» — значения с источником и подтверждением, ожидающие «Подтвердить», пометка «Проверьте»,
// предложение значения (в том числе за прошлый год) и история. Ответы сервера — MSW; сайт только показывает числа и читает ввод.
import type { RateRow, RatesTable } from "@kosht/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { AdminRatesPage } from "./AdminRatesPage.tsx";

const row = (extra: Partial<RateRow> & Pick<RateRow, "id" | "param">): RateRow => ({
  unit: "byn-minor",
  group: "std-deduction",
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  value: 21_600,
  status: "confirmed",
  source: { act: "Hk0900071", article: "209", point: "1.1", url: null, linked: true },
  confirmed: { by: "developer", on: "2026-10-30" },
  drift: false,
  ...extra,
});

const ID = (n: number) => `01990000-0000-7000-8000-00000000000${String(n)}`;

const table = (items: RateRow[]): RatesTable => ({
  items,
  counts: {
    pending: items.filter((r) => r.status === "pending").length,
    drift: items.filter((r) => r.drift).length,
  },
});

const BASE = row({ id: ID(1), param: "ndfl.std-deduction.base" });
const CHILD = row({
  id: ID(2),
  param: "ndfl.std-deduction.child",
  value: 6300,
  drift: true,
  source: { act: "Hk0900071", article: "209", point: "1.2", url: null, linked: true },
});
const RATE = row({
  id: ID(3),
  param: "ndfl.rate.base",
  unit: "percent-bp",
  group: "ndfl-rate",
  value: 1300,
  status: "pending",
  confirmed: null,
  source: { act: "Hk0900071", article: "214", point: null, url: null, linked: false },
});
const PDN = row({
  id: ID(4),
  param: "pdn.limit.default",
  unit: "percent-bp",
  group: "pdn",
  value: 4000,
  status: "pending",
  confirmed: null,
  source: {
    act: null,
    article: "ПДН",
    point: null,
    url: "https://www.nbrb.by/finsector/",
    linked: false,
  },
});
const OLD = row({
  id: ID(5),
  param: "ndfl.std-deduction.disabled",
  value: 30_600,
  status: "superseded",
});

function render(items: RateRow[] = [BASE, CHILD, RATE, PDN, OLD]) {
  server.use(http.get("*/api/admin/rates", () => HttpResponse.json(table(items))));
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AdminRatesPage />
    </QueryClientProvider>,
  );
}

describe("ADM-11, TAX-03: таблица значений", () => {
  it("значение, период, источник и кто подтвердил; вычеты — «в месяц», проценты — «13 %», деньги — по DES-17", async () => {
    render();
    const line = (await screen.findByText("Стандартный вычет при доходе до порога")).closest("tr");
    expect(line).not.toBeNull();
    const cells = within(line as HTMLElement);
    expect(cells.getByText(/216,00 BYN в месяц/u)).toBeVisible();
    expect(cells.getByText("Период: 01.01.2026 — 31.12.2026")).toBeVisible();
    expect(cells.getByText("Hk0900071, ст. 209, п. 1.1")).toBeVisible();
    expect(cells.getByText("Подтверждено")).toBeVisible();
    expect(cells.getByText("разработчиком, 30.10.2026")).toBeVisible();
    const rate = (await screen.findByText("Ставка подоходного налога")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(rate).getByText("13 %")).toBeVisible();
    expect(within(rate).getByText("Hk0900071, ст. 214")).toBeVisible();
  });

  it("ожидающее значение — «Ждёт подтверждения» с пояснением и кнопками; источник вне pravo.by — с адресом", async () => {
    render();
    const pdn = (await screen.findByText("Предел долговой нагрузки (ПДН)")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(pdn).getByText("Ждёт подтверждения")).toBeVisible();
    expect(within(pdn).getByText(/Не действует, пока не нажато/u)).toBeVisible();
    expect(within(pdn).getByText("Источник вне pravo.by")).toBeVisible();
    expect(within(pdn).getByText("https://www.nbrb.by/finsector/")).toBeVisible();
    expect(within(pdn).getByRole("button", { name: /^Подтвердить значение/u })).toBeVisible();
  });

  it("пометка расхождения с новой редакцией — «Проверьте» с иконкой; вытесненное значение — только в истории", async () => {
    render();
    const child = (await screen.findByText("Вычет на ребёнка до 18 лет или иждивенца")).closest(
      "tr",
    ) as HTMLElement;
    expect(
      within(child).getByText(/Проверьте: в новой редакции нормы этого числа нет/u),
    ).toBeVisible();
    expect(
      screen.queryByText("Вычет для льготных категорий (инвалиды I и II групп и др.)", {
        selector: "th",
      }),
    ).toBeNull();
    expect(screen.getByText(/заменено новым значением/u)).toBeVisible();
  });

  it("ошибка сервера — понятный текст, а не пустой экран", async () => {
    server.use(http.get("*/api/admin/rates", () => HttpResponse.json({}, { status: 500 })));
    renderWithProviders(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AdminRatesPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось загрузить таблицу ставок",
    );
  });
});

describe("ADM-11: «Подтвердить», «Отклонить», предложение", () => {
  it("«Подтвердить» и «Отклонить» уходят с id значения", async () => {
    const sent: { path: string; body: unknown }[] = [];
    for (const action of ["confirm", "reject"] as const) {
      server.use(
        http.post(`*/api/admin/rates/${action}`, async ({ request }) => {
          sent.push({ path: action, body: await request.json() });
          return HttpResponse.json(table([BASE, CHILD, RATE, PDN, OLD]));
        }),
      );
    }
    render();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Подтвердить значение: Ставка подоходного налога",
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: /^Отклонить значение: Предел долговой нагрузки/u }),
    );
    expect(sent).toEqual([
      { path: "confirm", body: { id: ID(3) } },
      { path: "reject", body: { id: ID(4) } },
    ]);
  });

  it("конфликт периодов при «Подтвердить» — понятная причина у строки", async () => {
    server.use(
      http.post("*/api/admin/rates/confirm", () =>
        HttpResponse.json(
          {
            code: "CONFLICT",
            status: 409,
            message: "CONFLICT",
            defined: true,
            data: { requestId: "r", params: { reason: "period-overlap" } },
          },
          { status: 409 },
        ),
      ),
    );
    render();
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "Подтвердить значение: Ставка подоходного налога",
      }),
    );
    expect(
      await screen.findByText(/Период пересекается с другим подтверждённым значением/u),
    ).toBeVisible();
  });

  it("«Изменить»: форма с данными строки; число читается как «216,50» → 21650 копеек, период и источник уходят на сервер", async () => {
    const sent: unknown[] = [];
    server.use(
      http.post("*/api/admin/rates/propose", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(table([BASE]));
      }),
    );
    render();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Изменить значение: Стандартный вычет при доходе до порога",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Акт pravo.by (ID)")).toHaveValue("Hk0900071");
    const value = within(dialog).getByRole("textbox", { name: "Значение, BYN" });
    await user.clear(value);
    await user.type(value, "230,50");
    await user.click(within(dialog).getByRole("button", { name: "Предложить" }));
    expect(sent).toEqual([
      {
        param: "ndfl.std-deduction.base",
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        value: 23_050,
        sourceAct: "Hk0900071",
        sourceArticle: "209",
        sourcePoint: "1.1",
        sourceUrl: null,
      },
    ]);
  });

  it("проценты вводятся как «13,5» → 1350; не число — подсказка, на сервер ничего не уходит", async () => {
    const sent: unknown[] = [];
    server.use(
      http.post("*/api/admin/rates/propose", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(table([BASE]));
      }),
    );
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Добавить значение" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Параметр" }));
    await user.click(await screen.findByRole("option", { name: "Ставка подоходного налога" }));
    const value = within(dialog).getByRole("textbox", { name: "Значение, %" });
    await user.type(value, "много");
    await user.click(within(dialog).getByRole("button", { name: "Предложить" }));
    expect(await within(dialog).findByText("Введите число: 216 или 13,5.")).toBeVisible();
    expect(sent).toEqual([]);
    await user.clear(value);
    await user.type(value, "13,5");
    await user.type(within(dialog).getByLabelText("Действует с"), "2027-01-01");
    await user.type(
      within(dialog).getByLabelText("Адрес источника вне pravo.by"),
      "https://example.test/n",
    );
    await user.click(within(dialog).getByRole("button", { name: "Предложить" }));
    expect(sent).toMatchObject([
      {
        param: "ndfl.rate.base",
        value: 1350,
        validFrom: "2027-01-01",
        sourceUrl: "https://example.test/n",
      },
    ]);
  });

  it("сервер отклонил предложение (нет источника) — причина словами в форме", async () => {
    server.use(
      http.post("*/api/admin/rates/propose", () =>
        HttpResponse.json(
          {
            code: "VALIDATION",
            status: 400,
            message: "VALIDATION",
            defined: true,
            data: { requestId: "r", params: { field: "source", reason: "required" } },
          },
          { status: 400 },
        ),
      ),
    );
    render();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Изменить значение: Стандартный вычет при доходе до порога",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Предложить" }));
    expect(
      await within(dialog).findByText("Укажите источник: акт и статью либо адрес."),
    ).toBeVisible();
  });
});
