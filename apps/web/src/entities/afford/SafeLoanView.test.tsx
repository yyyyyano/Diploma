// AFF-05, AFF-06, P1, P6: безопасный платёж — предел, формула «предел − платежи», сумма кредита по ставке и сроку; предел не
// подтверждён — «нет предела» без чисел; нет дохода — вопрос; платежи выше предела — запаса нет. Числа — из ответа сервера.
import type { Money as MoneyValue } from "@kosht/kernel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { LOAN_NO_LIMIT, LOAN_OK } from "./fixtures.ts";
import { formatRate, SafeLoanView } from "./SafeLoanView.tsx";

const render = (ui: Parameters<typeof renderWithProviders>[0]) =>
  renderWithProviders(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("AFF-05: пример SPEC — доход 3 200, кредиты 800, предел 40 %", () => {
  it("предел 1 280 − платежи 800 = новый платёж до 480; доход помечен оценкой по выпискам; у каждого числа ⓘ", () => {
    render(<SafeLoanView result={LOAN_OK} />);
    const facts = screen.getByRole("region", { name: "Безопасный платёж по кредиту" });
    expect(within(facts).getByText("3 200,00")).toBeVisible();
    expect(within(facts).getByText("оценка по выпискам")).toBeVisible();
    expect(within(facts).getAllByText("800,00").length).toBeGreaterThan(0);
    expect(within(facts).getAllByText("480,00").length).toBeGreaterThan(0);
    expect(within(facts).getByText("1 280,00")).toBeVisible();
    expect(within(facts).getByText(/Предел 40 % от дохода/u)).toBeVisible();
    for (const subject of ["доход в месяц", "платежи по кредитам", "безопасный платёж"]) {
      expect(
        within(facts).getByRole("button", {
          name: new RegExp(`Откуда эта цифра: ${subject}`, "u"),
        }),
      ).toBeVisible();
    }
    expect(within(facts).getByText(/Кошт не советует банки и кредитные продукты/u)).toBeVisible();
  });

  it("ставка 14 % и срок 60 мес. — «кредит примерно до 20 628,96»", () => {
    render(<SafeLoanView result={LOAN_OK} />);
    expect(
      screen.getByText(/При ставке 14 % и сроке 60 мес\. это кредит примерно до/u),
    ).toBeVisible();
    expect(screen.getByText("20 628,96")).toBeVisible();
  });

  it("ставки и срока нет — просьба их назвать, банки не подбираются", () => {
    render(<SafeLoanView result={{ ...LOAN_OK, maxLoan: null }} />);
    expect(screen.getByText(/Укажите ставку и срок/u)).toBeVisible();
  });
});

describe("AFF-05: нет чисел — честный ответ", () => {
  it("предел не подтверждён — объяснение и ни одного «безопасного платежа»", () => {
    render(<SafeLoanView result={LOAN_NO_LIMIT} />);
    expect(screen.getByText(/Предел долговой нагрузки ещё не подтверждён/u)).toBeVisible();
    expect(screen.queryByText("Новый платёж — не больше")).toBeNull();
    expect(screen.queryByText("0,00")).toBeNull();
  });

  it("платежи выше предела — запаса нет, а не отрицательный платёж", () => {
    render(
      <SafeLoanView result={{ ...LOAN_OK, safePayment: null, exceeded: true, maxLoan: null }} />,
    );
    expect(screen.getByText(/запаса для нового платежа нет/u)).toBeVisible();
    expect(screen.queryByText("Новый платёж — не больше")).toBeNull();
  });

  it("дохода нет — вопрос; названный доход уходит в обработчик", async () => {
    const onIncome = vi.fn<(income: MoneyValue) => void>();
    render(
      <SafeLoanView
        result={{
          ...LOAN_NO_LIMIT,
          status: "no-income",
          missing: [],
          income: null,
          incomeSource: null,
          currentPayments: null,
        }}
        onIncome={onIncome}
      />,
    );
    expect(screen.getByText(/Регулярный доход не найден/u)).toBeVisible();
    await userEvent.type(screen.getByLabelText("Доход в месяц, BYN"), "3000");
    await userEvent.click(screen.getByRole("button", { name: "Посчитать" }));
    expect(onIncome).toHaveBeenCalledWith({ minor: 300_000, currency: "BYN" });
  });
});

describe("formatRate: сотые доли процента → текст", () => {
  it.each([
    [1400, "14"],
    [1450, "14,5"],
    [1405, "14,05"],
    [0, "0"],
    [50, "0,5"],
    [10_000, "100"],
  ])("%d → «%s»", (bp, text) => {
    expect(formatRate(bp)).toBe(text);
  });
});
