// TAX-01…07, TAX-04, TAX-06, DES-16: экран «Налоговые вычеты» — профиль занятости, калькулятор «Обучение / Жильё / Дети» с ответом
// сервера (все числа его, сайт не считает), вопрос о зарплате с сохранением факта, состояния. Сеть — MSW.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { DeductionsPage } from "./DeductionsPage.tsx";
import type { DeductionsSearch } from "./model/search.ts";

const TRACE = "0190f0a0-0000-7000-8000-0000000000a1";
const byn = (minor: number) => ({ minor, currency: "BYN" });
const amount = (minor: number) => ({ amount: byn(minor), traceId: TRACE });

const education = {
  kind: "education",
  status: "ok",
  reason: null,
  missing: [],
  year: 2026,
  employment: ["employee"],
  ratePercent: 13,
  deduction: amount(200_000),
  savingMonthly: null,
  savingYear: amount(26_000),
  savingTotal: amount(26_000),
  carryOver: null,
  term: null,
  termReason: null,
  income: null,
  standard: null,
  children: null,
  ways: ["employer", "tax-office"],
  flags: ["upper-bound", "ask-gross"],
  checklistId: "deduction-education",
  citations: [],
};

const checklist = {
  id: "deduction-education",
  title: "Вычет на обучение",
  summary: "Что собрать.",
  items: [],
  done: 0,
  total: 0,
};

function renderPage(search: DeductionsSearch = {}) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/deductions",
    component: () => <DeductionsPage search={search} />,
  });
  const stub = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, stub("/memory"), stub("/laws")]),
    history: createMemoryHistory({ initialEntries: ["/deductions"] }),
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

function profile(types: readonly string[] | null) {
  const facts =
    types === null
      ? []
      : [
          {
            id: "0190f0a0-0000-7000-8000-0000000000f1",
            topic: "employment",
            value: { key: "employment", types },
            source: "questionnaire",
            sourceRef: null,
            status: "confirmed",
            recordedOn: "2026-10-01",
            evaluation: null,
          },
        ];
  return http.get("*/api/profile/facts", () => HttpResponse.json({ onDate: "2026-11-01", facts }));
}

const checklistHandler = http.post("*/api/legal-consult/checklist", () =>
  HttpResponse.json(checklist),
);

describe("TAX-02, DES-16: профиль занятости", () => {
  it("загрузка — скелетон; потом тип занятости из профиля словами и ссылка «Изменить в профиле»", async () => {
    server.use(profile(["employee"]), checklistHandler);
    renderPage();
    expect(
      await screen.findByText(/Тип занятости \(из профиля\): Наёмный работник/u),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Изменить в профиле" })).toHaveAttribute(
      "href",
      "/memory",
    );
  });

  it("профиль без типа занятости — считаем как наёмного работника, с этим сказано", async () => {
    server.use(profile(null), checklistHandler);
    renderPage();
    expect(await screen.findByText(/Тип занятости в профиле не указан/u)).toBeVisible();
  });

  it("профиль загружается — скелетон, а не пустота", async () => {
    server.use(
      http.get("*/api/profile/facts", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderPage();
    expect(await screen.findAllByText("Загрузка…")).not.toHaveLength(0);
  });
});

describe("TAX-07, пример 1: обучение", () => {
  it("пусто → сумма → «Посчитать» шлёт вид и сумму в копейках; ответ сервера показан как есть: до 260,00 BYN, ставка 13 %, «Откуда эта цифра?»", async () => {
    const sent: unknown[] = [];
    server.use(
      profile(["employee"]),
      checklistHandler,
      http.post("*/api/tax/calculate", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(education);
      }),
    );
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText(/здесь появится расчёт/u)).toBeVisible();
    const submit = screen.getByRole("button", { name: "Посчитать" });
    expect(submit).toBeDisabled();

    await user.type(
      screen.getByRole("textbox", { name: "Сколько заплатили за обучение в году, BYN" }),
      "2000",
    );
    await user.click(submit);

    expect(await screen.findByText("до")).toBeVisible();
    expect(sent).toEqual([{ kind: "education", paid: byn(200_000) }]);
    expect(await screen.findAllByText(/260,00/u)).not.toHaveLength(0);
    expect(screen.getByText("13 %")).toBeVisible();
    expect(screen.getByRole("button", { name: /Откуда эта цифра: экономия/u })).toBeVisible();
    expect(screen.getByText(/Сумма «до»/u)).toBeVisible();
  });

  it("не число в поле — подсказка у поля, кнопка недоступна", async () => {
    server.use(profile(["employee"]), checklistHandler);
    const user = userEvent.setup();
    renderPage();
    await user.type(
      await screen.findByRole("textbox", { name: "Сколько заплатили за обучение в году, BYN" }),
      "много",
    );
    expect(screen.getByText("Введите сумму числом: 2000 или 2 000,50.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Посчитать" })).toBeDisabled();
  });

  it("облагаемый доход за год уходит во входе расчёта, когда его указали", async () => {
    const sent: unknown[] = [];
    server.use(
      profile(["employee"]),
      checklistHandler,
      http.post("*/api/tax/calculate", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(education);
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.type(
      await screen.findByRole("textbox", { name: "Сколько заплатили за обучение в году, BYN" }),
      "2000",
    );
    await user.type(screen.getByRole("textbox", { name: /Облагаемый доход за год, BYN/u }), "1500");
    await user.click(screen.getByRole("button", { name: "Посчитать" }));
    await waitFor(() =>
      expect(sent).toEqual([
        { kind: "education", paid: byn(200_000), annualTaxable: byn(150_000) },
      ]),
    );
  });
});

describe("TAX-07, пример 2 и 3: жильё и дети", () => {
  it("вкладка «Жильё» из адреса: поле расходов и зарплаты; ответ — срок «≈ 41 мес.» и пометка «оценка»", async () => {
    const sent: unknown[] = [];
    server.use(
      profile(["employee"]),
      http.post("*/api/legal-consult/checklist", () =>
        HttpResponse.json({ ...checklist, id: "deduction-housing" }),
      ),
      http.post("*/api/tax/calculate", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({
          ...education,
          kind: "housing",
          deduction: amount(12_000_000),
          savingTotal: amount(1_560_000),
          savingMonthly: amount(37_790),
          savingYear: amount(453_480),
          savingYearTotal: null,
          carryOver: null,
          term: { months: 41, approx: true, traceId: TRACE },
          income: amount(290_698),
          flags: ["income-estimated", "ask-gross"],
          checklistId: "deduction-housing",
        });
      }),
    );
    const user = userEvent.setup();
    renderPage({ kind: "housing" });
    await user.type(
      await screen.findByRole("textbox", { name: /Расходы на жильё, BYN/u }),
      "120000",
    );
    await user.type(screen.getByRole("textbox", { name: /Зарплата в месяц, BYN/u }), "2500");
    await user.click(screen.getByRole("radio", { name: "«На руки»" }));
    await user.click(screen.getByRole("button", { name: "Посчитать" }));
    expect(await screen.findByText("≈ 41 мес.")).toBeVisible();
    expect(sent).toEqual([
      {
        kind: "housing",
        expenses: byn(12_000_000),
        income: { amount: byn(250_000), basis: "net" },
      },
    ]);
    expect(screen.getByText(/Оценка: начисленная зарплата/u)).toBeVisible();
    expect(screen.getByRole("button", { name: /Откуда эта цифра: срок вычета/u })).toBeVisible();
  });

  it("вкладка «Дети»: суммы не вводят — считается по профилю; кнопка доступна сразу, есть ссылка на детей в профиле", async () => {
    server.use(profile(["employee"]), checklistHandler);
    renderPage({ kind: "children" });
    expect(await screen.findByRole("button", { name: "Посчитать" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Дети в профиле" })).toHaveAttribute("href", "/memory");
  });
});

describe("TAX-02, TAX-03: нет расчёта — объяснение, а не ноль", () => {
  it.each([
    ["npd-only", /К доходу на НПД вычеты по ст\. 209–211 НК не применяются/u],
    ["rate-unconfirmed", /нет подтверждённого значения/u],
    ["no-children", /нет детей до 18 лет/u],
  ] as const)("причина %s названа словами, суммы нет", async (reason, text) => {
    server.use(
      profile(["employee"]),
      checklistHandler,
      http.post("*/api/tax/calculate", () =>
        HttpResponse.json({
          ...education,
          status: reason === "rate-unconfirmed" ? "no-data" : "not-applicable",
          reason,
          ratePercent: null,
          deduction: null,
          savingYear: null,
          savingTotal: null,
          ways: [],
          flags: [],
        }),
      ),
    );
    const user = userEvent.setup();
    renderPage({ kind: reason === "no-children" ? "children" : "education" });
    if (reason !== "no-children") {
      await user.type(
        await screen.findByRole("textbox", { name: "Сколько заплатили за обучение в году, BYN" }),
        "2000",
      );
    }
    await user.click(await screen.findByRole("button", { name: "Посчитать" }));
    expect(await screen.findByText(text)).toBeVisible();
    expect(screen.queryByText(/Можно вернуть/u)).toBeNull();
  });

  it("ошибка расчёта — что случилось и что сделать", async () => {
    server.use(
      profile(["employee"]),
      checklistHandler,
      http.post("*/api/tax/calculate", () =>
        HttpResponse.json(
          {
            defined: false,
            code: "INTERNAL",
            status: 500,
            message: "INTERNAL",
            data: { requestId: "req-00000001", params: {} },
          },
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await user.type(
      await screen.findByRole("textbox", { name: "Сколько заплатили за обучение в году, BYN" }),
      "2000",
    );
    await user.click(screen.getByRole("button", { name: "Посчитать" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Не удалось посчитать/u);
  });
});

describe("TAX-04, PROF-04: вопрос о зарплате до вычета налогов", () => {
  it("ответ сохраняется фактом income.gross и расчёт повторяется с теми же суммами", async () => {
    const facts: unknown[] = [];
    let calls = 0;
    server.use(
      profile(["employee"]),
      checklistHandler,
      http.post("*/api/tax/calculate", () => {
        calls += 1;
        return HttpResponse.json(education);
      }),
      http.post("*/api/profile/facts", async ({ request }) => {
        facts.push(await request.json());
        return HttpResponse.json({ fact: {}, undoToken: "x" });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.type(
      await screen.findByRole("textbox", { name: "Сколько заплатили за обучение в году, BYN" }),
      "2000",
    );
    await user.click(screen.getByRole("button", { name: "Посчитать" }));
    expect(
      await screen.findByText("Какая у вас зарплата до вычета налогов — есть в расчётном листке?"),
    ).toBeVisible();
    await user.type(
      screen.getByRole("textbox", { name: "Зарплата до вычета налогов в месяц, BYN" }),
      "2500",
    );
    await user.click(screen.getByRole("button", { name: "Запомнить и пересчитать" }));
    await waitFor(() => expect(calls).toBe(2));
    expect(facts).toEqual([{ value: { key: "income.gross", amount: byn(250_000) } }]);
  });
});

describe("важное и подпись", () => {
  it("«Важно знать», «Не является юридической консультацией» и ссылка на базу законов", async () => {
    server.use(profile(["employee"]), checklistHandler);
    renderPage();
    expect(await screen.findByRole("heading", { name: "Важно знать" })).toBeVisible();
    expect(screen.getByText("Не является юридической консультацией")).toBeVisible();
    expect(screen.getByRole("link", { name: "Тексты норм в базе законов" })).toHaveAttribute(
      "href",
      "/laws",
    );
  });
});
