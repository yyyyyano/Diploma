// TAX-06, CHAT-04, P3: карточка расчёта вычета в чате — результат инструмента `calculate_deduction`: сумма, формула, «Откуда эта
// цифра?», нормы дословно, чек-лист за сообщением. Не по схеме — ничего; нет расчёта — причина словами. Сеть — MSW.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../../test/msw.ts";
import { renderWithProviders } from "../../../test/render.tsx";
import { DeductionCard } from "./DeductionCard.tsx";

const MESSAGE = "0190f0a0-0000-7000-8000-0000000000b1";
const TRACE = "0190f0a0-0000-7000-8000-0000000000a1";
const byn = (minor: number) => ({ minor, currency: "BYN" });
const amount = (minor: number) => ({ amount: byn(minor), traceId: TRACE });

const children = {
  kind: "children",
  status: "ok",
  reason: null,
  missing: [],
  year: 2026,
  employment: ["employee"],
  ratePercent: 13,
  deduction: amount(24_000),
  savingMonthly: amount(3120),
  savingYear: amount(37_440),
  savingTotal: null,
  carryOver: null,
  term: null,
  termReason: null,
  income: null,
  standard: null,
  children: { count: 2, increased: true },
  ways: ["employer"],
  flags: ["upper-bound"],
  checklistId: "deduction-standard",
  citations: [
    {
      n: 1,
      kind: "quote",
      versionId: "0190f0a0-0000-7000-8000-0000000000c1",
      pravoId: "Hk0900071",
      actTitle: "Налоговый кодекс Республики Беларусь (Особенная часть)",
      label: "ст. 209, п. 1.2",
      path: "НК › Статья 209",
      text: "1.2. в размере 63 белорусских рублей в месяц на ребенка до восемнадцати лет",
      edition: "в редакции на 30.10.2026",
      editionOn: "2026-10-30",
      url: "https://pravo.by/document/?guid=3871&p0=Hk0900071",
      changedSince: false,
      notes: [],
    },
  ],
};

function render(output: unknown) {
  server.use(
    http.post("*/api/legal-consult/checklist", () =>
      HttpResponse.json({
        id: "deduction-standard",
        title: "Стандартные вычеты на детей",
        summary: "Что подать.",
        items: [],
        done: 0,
        total: 0,
      }),
    ),
  );
  return renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DeductionCard output={output} messageId={MESSAGE} />
    </QueryClientProvider>,
  );
}

describe("TAX-07, пример 3: двое детей", () => {
  it("вычет 240,00 в месяц, экономия 31,20 в месяц и 374,40 в год, ставка 13 %, пометка «до» и «Откуда эта цифра?»", async () => {
    render(children);
    expect(await screen.findByText("Расчёт вычета")).toBeVisible();
    expect(screen.getAllByText(/240,00/u)).not.toHaveLength(0);
    expect(screen.getAllByText(/31,20/u)).not.toHaveLength(0);
    expect(screen.getByText(/374,40/u)).toBeVisible();
    expect(screen.getByText("13 %")).toBeVisible();
    expect(screen.getByText(/Сумма «до»/u)).toBeVisible();
    expect(
      screen.getByText("Дети до 18 лет: 2. Повышенный вычет на каждого ребёнка."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Откуда эта цифра: экономия в месяц/u }),
    ).toBeVisible();
  });

  it("норма — дословная цитата в раскрывающемся блоке, с редакцией и ссылкой на pravo.by", async () => {
    render(children);
    const user = userEvent.setup();
    await user.click(await screen.findByText("Что говорит закон"));
    expect(
      screen.getByText(
        "1.2. в размере 63 белорусских рублей в месяц на ребенка до восемнадцати лет",
      ),
    ).toBeVisible();
    expect(screen.getByText(/в редакции на 30\.10\.2026/u)).toBeVisible();
  });

  it("чек-лист документов — рядом с расчётом, галочки за этим сообщением", async () => {
    const asked: unknown[] = [];
    server.use(
      http.post("*/api/legal-consult/checklist", async ({ request }) => {
        asked.push(await request.json());
        return HttpResponse.json({
          id: "deduction-standard",
          title: "Стандартные вычеты на детей",
          summary: "Что подать.",
          items: [],
          done: 0,
          total: 0,
        });
      }),
    );
    renderWithProviders(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DeductionCard output={children} messageId={MESSAGE} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Стандартные вычеты на детей" }),
    ).toBeVisible();
    expect(asked).toEqual([
      { id: "deduction-standard", subject: { kind: "message", id: MESSAGE } },
    ]);
  });
});

describe("TAX-02, TAX-03: нет расчёта", () => {
  it("только НПД — причина словами и ни одной суммы", async () => {
    render({
      ...children,
      status: "not-applicable",
      reason: "npd-only",
      ratePercent: null,
      deduction: null,
      savingMonthly: null,
      savingYear: null,
      children: null,
      ways: [],
      flags: [],
      citations: [],
    });
    expect(await screen.findByText(/К доходу на НПД вычеты по ст\. 209–211 НК/u)).toBeVisible();
    expect(screen.queryByText(/Можно вернуть/u)).toBeNull();
  });

  it("результат не по схеме — карточки нет, ответ ассистента остаётся", () => {
    render({ kind: "children", status: "ok" });
    expect(screen.queryByText("Расчёт вычета")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
