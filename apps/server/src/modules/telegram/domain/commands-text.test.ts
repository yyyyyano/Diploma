// TG-07: тексты /balance, /limits, /week — слова вокруг готовых чисел сервера; нет данных — подсказка, а не пустота.
import type { BudgetLimit, DashboardOverview, WeeklySummary } from "@kosht/contract";
import { createTelegramT } from "@kosht/i18n";
import { describe, expect, it } from "vitest";
import { balanceText, limitsText, weekText } from "./commands-text.ts";

const t = createTelegramT();
const byn = (minor: number) => ({ minor, currency: "BYN" }) as never;
const plain = (text: string) => text.replaceAll(" ", " ");
const account = (name: string | null, minor: number, mask: string | null = null) =>
  ({
    name,
    bank: null,
    mask,
    balance: byn(minor),
  }) as unknown as DashboardOverview["accounts"]["items"][number];
const overview = (
  items: DashboardOverview["accounts"]["items"],
  free: { minor: number | null; months: number } = { minor: 84_000, months: 3 },
) =>
  ({
    accounts: { items, total: items.length === 0 ? null : { amount: byn(114_000) } },
    freeBalance: { amount: free.minor === null ? null : byn(free.minor), months: free.months },
  }) as DashboardOverview;

describe("/balance", () => {
  it("итог, счета и свободный остаток", () => {
    expect(
      plain(
        balanceText(t, overview([account("Наличные", 12_000), account(null, 102_000, "4821")])),
      ),
    ).toBe(
      "На счетах: 1 140,00 BYN\n• Наличные — 120,00 BYN\n• Счёт •• 4821 — 1 020,00 BYN\nСвободный остаток: 840,00 BYN — по доходам и расходам за 3 мес.",
    );
  });

  it("мало истории — честно, без числа; счетов нет — подсказка", () => {
    expect(
      balanceText(t, overview([account("Наличные", 0)], { minor: null, months: 0 })),
    ).toContain("пока не посчитать");
    expect(balanceText(t, overview([]))).toContain("Счетов пока нет");
  });

  it("больше восьми счетов — «…и ещё N»", () => {
    const many = Array.from({ length: 10 }, (_, at) => account(`Счёт ${String(at)}`, 100));
    const text = balanceText(t, overview(many));
    expect(text).toContain("…и ещё 2 счёта");
    expect(text.split("\n").filter((row) => row.startsWith("•"))).toHaveLength(8);
  });
});

describe("/limits", () => {
  const limit = {
    categoryKey: "system:cafes",
    percent: 84,
    spent: byn(42_000),
    limit: byn(50_000),
  } as unknown as BudgetLimit;
  it("строка на лимит с названием категории и днями до конца месяца", () => {
    expect(plain(limitsText(t, [limit], 10, () => "Кафе, рестораны"))).toBe(
      "Лимиты месяца, до конца месяца 10 дн.:\n«Кафе, рестораны»: 84% — 420,00 BYN из 500,00 BYN",
    );
  });
  it("лимитов нет — подсказка", () => {
    expect(limitsText(t, [], 10, () => "")).toContain("Лимитов пока нет");
  });
});

describe("/week", () => {
  it("заголовок с неделей и текст сводки", () => {
    const summary = {
      weekStart: "2026-10-26",
      weekEnd: "2026-11-01",
      text: "Вы потратили 412,30 BYN.",
    } as WeeklySummary;
    expect(weekText(t, summary)).toBe(
      "Итоги недели 26.10.2026 — 01.11.2026\nВы потратили 412,30 BYN.",
    );
  });
});
