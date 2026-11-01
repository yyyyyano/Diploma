// WEEK-01, WEEK-02, DASH-02, P2: карточка «Итоги недели» — текст сводки, три числа, «Откуда эта цифра?», источник текста.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { SUMMARY, TRACE } from "./fixtures.ts";
import { WeeklyCard } from "./WeeklyCard.tsx";

const render = (ui: Parameters<typeof renderWithProviders>[0]) =>
  renderWithProviders(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("карточка «Итоги недели»", () => {
  it("период, текст сводки и три числа: потрачено с «обычно», самая затратная категория, платежи недели с названиями", () => {
    render(<WeeklyCard summary={SUMMARY} />);
    const card = screen.getByRole("region", { name: "Итоги недели" });
    expect(within(card).getByText("Неделя 26.10.2026 — 01.11.2026")).toBeVisible();
    expect(within(card).getByText(/потратили 312,00 BYN, на 18 % больше обычного/u)).toBeVisible();
    expect(within(card).getAllByText("312,00").length).toBeGreaterThan(0);
    expect(within(card).getByText("264,41")).toBeVisible();
    expect(within(card).getByText("Такси", { selector: "p" })).toBeVisible();
    expect(within(card).getByText("74,00")).toBeVisible();
    expect(within(card).getByText("Интернет 03.11, Рассрочка 05.11")).toBeVisible();
    expect(within(card).getByText("Текст по шаблону из готовых чисел")).toBeVisible();
  });

  it("текст составила модель — так и написано", () => {
    render(<WeeklyCard summary={{ ...SUMMARY, textSource: "model" }} />);
    expect(screen.getByText("Текст составила модель по готовым числам")).toBeVisible();
  });

  it("нет среднего и платежей — их блоков нет, а не нули", () => {
    render(
      <WeeklyCard
        summary={{
          ...SUMMARY,
          average: null,
          deviation: null,
          categories: [],
          upcoming: { ...SUMMARY.upcoming, payments: null, items: [] },
        }}
      />,
    );
    expect(screen.queryByText(/Обычно за неделю/u)).toBeNull();
    expect(screen.queryByText("Ближайшие семь дней")).toBeNull();
    expect(screen.queryByText("Больше всего")).toBeNull();
  });

  it("кнопка ⓘ у трат открывает сохранённый расчёт по traceId", async () => {
    const asked: string[] = [];
    server.use(
      http.get("*/api/explain", ({ request }) => {
        asked.push(request.url);
        return HttpResponse.json({
          id: TRACE,
          createdAt: "2026-11-02T06:00:00Z",
          period: null,
          trace: {
            key: "transactions.expense",
            op: "sum",
            value: { minor: 31_200, currency: "BYN" },
            inputs: [],
            refs: [],
          },
        });
      }),
    );
    render(<WeeklyCard summary={SUMMARY} />);
    await userEvent.click(screen.getByRole("button", { name: /Откуда эта цифра: траты недели/u }));
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(asked.length).toBeGreaterThan(0);
  });
});
