// AFF-03, AFF-04, AFF-07, AFF-08, P1, P2, P6: результат сценариев — три карточки с минимумом, риском, сдвигом цели, накоплением,
// график с подписями, «Откуда эта цифра?» у каждого числа, вопрос про доход. Тест ничего не считает: числа — из ответа сервера.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Money as MoneyValue } from "@kosht/kernel";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { AffordResultView } from "./AffordResultView.tsx";
import { NEEDS_INCOME, RISKY, SAFE, TRACE } from "./fixtures.ts";

/** Панель «Откуда эта цифра?» читает сервер — нужен клиент запросов; сеть — MSW. */
function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("AFF-03, AFF-04: сценарии с риском", () => {
  it("заголовок с названием и суммой, три карточки по порядку, минимум и дата, риск с датой и суммой, сдвиг цели, накопление", () => {
    renderWithQuery(<AffordResultView result={RISKY} name="Ноутбук" />);
    expect(
      screen.getByRole("heading", { name: /^Ноутбук за 3\s000,00\sBYN — три сценария$/u }),
    ).toBeVisible();
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(3);
    expect(within(cards[0] as HTMLElement).getByText("Купить сейчас")).toBeVisible();
    expect(within(cards[0] as HTMLElement).getByText("Риск просадки")).toBeVisible();
    expect(within(cards[0] as HTMLElement).getByText(/−739,44/u)).toBeVisible();
    expect(within(cards[0] as HTMLElement).getByText("24.10.2026")).toBeVisible();
    expect(
      within(cards[0] as HTMLElement).getByText(
        /С 21\.10\.2026 остаток уходит ниже нуля: не хватит 739,44\sBYN к 24\.10\.2026/u,
      ),
    ).toBeVisible();
    expect(
      within(cards[0] as HTMLElement).getByText(
        /из цели «Отпуск»: она сдвинется примерно на 7 мес\./u,
      ),
    ).toBeVisible();
    expect(within(cards[1] as HTMLElement).getByText("После следующего дохода")).toBeVisible();
    expect(
      within(cards[1] as HTMLElement).getByText(/Накоплений в целях не хватает/u),
    ).toBeVisible();
    expect(within(cards[2] as HTMLElement).getByText("342,23")).toBeVisible();
    expect(
      within(cards[2] as HTMLElement).getByText(/наберёте к 21\.07\.2027 · 9 мес\./u),
    ).toBeVisible();
    expect(within(cards[2] as HTMLElement).getByText("Рекомендуемо по расчёту")).toBeVisible();
  });

  it("«Учтено»: остаток, обычные траты, доход, обязательные платежи; налог без суммы назван; оценка помечена", () => {
    renderWithQuery(<AffordResultView result={RISKY} />);
    const considered = screen.getByText("Учтено").parentElement as HTMLElement;
    expect(within(considered).getByText("2 839,64")).toBeVisible();
    expect(within(considered).getByText("45,39")).toBeVisible();
    expect(within(considered).getByText("677,77")).toBeVisible();
    expect(screen.getByText("Не учтён налог 15.11.2026 — сумма придёт в извещении")).toBeVisible();
    expect(screen.getByText("Оценка по вашим данным")).toBeVisible();
  });

  it("график: подпись для диктора с минимумами сценариев и легенда", () => {
    renderWithQuery(<AffordResultView result={RISKY} />);
    const chart = screen.getByRole("figure", { name: /График остатка по дням/u });
    expect(chart.getAttribute("aria-label")).toMatch(/1 · мин\. −739,44\sBYN · 24\.10\.2026/u);
    expect(chart.getAttribute("aria-label")).toMatch(/2 · мин\. −424,45\sBYN · 24\.11\.2026/u);
    expect(screen.getByText("2 · После дохода 25.10.2026")).toBeVisible();
    expect(screen.getByText(/^677,77\sBYN — месячные обязательные платежи$/u)).toBeVisible();
  });
});

describe("AFF-03: сценарии без риска", () => {
  it("«Без риска», «обязательные платежи покрыты», «цели не сдвигаются»; рекомендован первый", () => {
    renderWithQuery(<AffordResultView result={SAFE} />);
    const cards = screen.getAllByRole("article");
    expect(within(cards[0] as HTMLElement).getByText("Без риска")).toBeVisible();
    expect(within(cards[0] as HTMLElement).getByText("Обязательные платежи покрыты")).toBeVisible();
    expect(within(cards[0] as HTMLElement).getByText("Цели не сдвигаются")).toBeVisible();
    expect(within(cards[0] as HTMLElement).getByText("Рекомендуемо по расчёту")).toBeVisible();
    expect(within(cards[1] as HTMLElement).queryByText("Рекомендуемо по расчёту")).toBeNull();
  });
});

describe("P2: «Откуда эта цифра?»", () => {
  it("кнопка ⓘ у минимального остатка открывает сохранённый расчёт по traceId", async () => {
    const asked: string[] = [];
    server.use(
      http.get("*/api/explain", ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("input") ?? "");
        return HttpResponse.json({
          id: TRACE,
          createdAt: "2026-10-21T09:00:00Z",
          period: null,
          trace: {
            key: "afford.minBalance",
            op: "value",
            value: { minor: -73_944, currency: "BYN" },
            inputs: [],
            refs: [],
          },
        });
      }),
    );
    renderWithQuery(<AffordResultView result={RISKY} />);
    const cards = screen.getAllByRole("article");
    await userEvent.click(
      within(cards[0] as HTMLElement).getByRole("button", {
        name: /Откуда эта цифра: минимальный остаток/u,
      }),
    );
    await vi.waitFor(() => expect(asked.length).toBeGreaterThan(0));
  });
});

describe("AFF-08: регулярного дохода нет", () => {
  it("сценарии без дохода названы причиной, форма дохода и дня вызывает пересчёт с названными значениями", async () => {
    const onIncome = vi.fn<(income: MoneyValue, on: string) => void>();
    renderWithQuery(<AffordResultView result={NEEDS_INCOME} onIncome={onIncome} />);
    expect(screen.getByText("Регулярный доход не найден")).toBeVisible();
    expect(screen.getAllByText(/Нужен регулярный доход/u).length).toBeGreaterThan(0);
    const submit = screen.getByRole("button", { name: "Пересчитать" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Доход в месяц, BYN"), "2400");
    await userEvent.type(screen.getByLabelText("День поступления"), "2026-11-05");
    await userEvent.click(submit);
    expect(onIncome).toHaveBeenCalledWith({ minor: 240_000, currency: "BYN" }, "2026-11-05");
  });

  it("в чате (без обработчика) формы нет — доход спрашивает агент", () => {
    renderWithQuery(<AffordResultView result={NEEDS_INCOME} />);
    expect(screen.queryByRole("button", { name: "Пересчитать" })).toBeNull();
  });
});
