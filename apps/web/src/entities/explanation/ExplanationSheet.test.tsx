// EXPL-01, EXPL-02: панель «Откуда эта цифра?» загружает сохранённый расчёт по traceId и рисует формулу из словаря
// formulas (у вычитания слагаемые после первого — с «−»), период и основания со ссылками; не загрузился — что делать.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TraceId } from "@kosht/kernel";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { ExplanationSheet } from "./ExplanationSheet.tsx";

const ID = TraceId.parse("0199f0a0-0000-7000-8000-0000000000e1");
const byn = (minor: number) => ({ minor, currency: "BYN" });

const explanation = {
  id: ID,
  trace: {
    key: "fin.freeBalance",
    op: "sub",
    value: byn(84_000),
    refs: [],
    inputs: [
      {
        key: "fin.averageIncome",
        op: "value",
        value: byn(240_000),
        inputs: [],
        refs: [{ kind: "transaction", id: "0199f0a0-0000-7000-8000-0000000000a1" }],
      },
      { key: "fin.obligation.utilities", op: "value", value: byn(18_000), inputs: [], refs: [] },
      {
        key: "fin.obligation.loan",
        op: "value",
        value: byn(138_000),
        inputs: [],
        refs: [{ kind: "fxRate", id: "usd-2026-10-01" }],
      },
    ],
  },
  period: { from: "2026-07-01", to: "2026-09-30" },
  createdAt: "2026-10-21T09:00:00.000Z",
};

function renderSheet() {
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ExplanationSheet traceId={ID} opened onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("EXPL-01: панель «Откуда эта цифра?»", () => {
  it("формула с подписями из словаря, знаки слагаемых, итог, период и основания", async () => {
    let asked: string | null = null;
    server.use(
      http.get("*/api/explain", ({ request }) => {
        asked = new URL(request.url).searchParams.get("id");
        return HttpResponse.json(explanation);
      }),
    );
    renderSheet();
    const panel = await screen.findByRole("dialog", { name: "Откуда эта цифра?" });
    const formula = await within(panel).findByRole("region", { name: "Расчёт" });
    expect(formula).toHaveTextContent("Средний регулярный доход");
    expect(formula).toHaveTextContent(/\+2\s400,00/);
    expect(formula).toHaveTextContent(/ЖКХ−180,00/);
    expect(within(panel).getByText("Период: 01.07.2026 — 30.09.2026")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Операция" })).toHaveAttribute(
      "href",
      "/operations?open=0199f0a0-0000-7000-8000-0000000000a1",
    );
    expect(within(panel).getByText("Курс НБРБ")).toBeInTheDocument();
    expect(asked).toBe(ID);
  });

  it("расчёт не найден — понятное сообщение", async () => {
    server.use(
      http.get("*/api/explain", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "NOT_FOUND",
            status: 404,
            message: "NOT_FOUND",
            data: { requestId: "req-00000001", params: {} },
          },
          { status: 404 },
        ),
      ),
    );
    renderSheet();
    expect(await screen.findByRole("alert")).toHaveTextContent("Расчёт не загрузился");
  });
});
