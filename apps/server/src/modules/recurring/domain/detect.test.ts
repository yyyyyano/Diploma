// REC-01: поиск регулярных операций по истории — один контрагент, похожая сумма, устойчивый период.
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { detect, DEFAULT_DETECT, type HistoryOp } from "./detect.ts";

const d = (text: string) => LocalDate.parse(text);
let counter = 0;
function op(over: Omit<Partial<HistoryOp>, "on"> & { on: string }): HistoryOp {
  counter += 1;
  return {
    id: `op-${counter}`,
    merchantKey: "shop",
    merchantName: "Магазин",
    flow: "expense",
    amountMinor: 1_000,
    categoryCode: "other",
    categoryId: null,
    ...over,
    on: d(over.on),
  };
}
const today = d("2026-10-28");

describe("REC-01: месяц", () => {
  it("три повтора 9-го числа по 60,00 → ежемесячный, следующий — 9 ноября", () => {
    const found = detect(
      [
        op({ on: "2026-08-09", amountMinor: 6_000 }),
        op({ on: "2026-09-09", amountMinor: 6_000 }),
        op({ on: "2026-10-09", amountMinor: 6_000 }),
      ],
      today,
      DEFAULT_DETECT,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      period: "month",
      nextExpectedOn: "2026-11-09",
      lastOccurredOn: "2026-10-09",
      anchorDay: 9,
    });
    expect(found[0]?.occurrences.map((o) => o.id)).toHaveLength(3);
  });

  it("два повтора — мало (для месячных нужно три)", () => {
    const found = detect(
      [op({ on: "2026-09-09" }), op({ on: "2026-10-09" })],
      today,
      DEFAULT_DETECT,
    );
    expect(found).toEqual([]);
  });

  it("сумма гуляет в пределах 15 % (ЖКХ 172,10 · 185,70 · 201,40) — это одна серия", () => {
    const found = detect(
      [
        op({ on: "2026-08-14", amountMinor: 17_210 }),
        op({ on: "2026-09-14", amountMinor: 18_570 }),
        op({ on: "2026-10-14", amountMinor: 20_140 }),
      ],
      today,
      DEFAULT_DETECT,
    );
    expect(found).toHaveLength(1);
  });

  it("разброс суммы больше 15 % — серии нет", () => {
    const found = detect(
      [
        op({ on: "2026-08-14", amountMinor: 10_000 }),
        op({ on: "2026-09-14", amountMinor: 14_000 }),
        op({ on: "2026-10-14", amountMinor: 20_000 }),
      ],
      today,
      DEFAULT_DETECT,
    );
    expect(found).toEqual([]);
  });

  it("сдвиг даты в пределах ±5 дней допустим, больше — нет", () => {
    const near = detect(
      [op({ on: "2026-08-10" }), op({ on: "2026-09-14" }), op({ on: "2026-10-12" })],
      today,
      DEFAULT_DETECT,
    );
    expect(near).toHaveLength(1);
    const far = detect(
      [op({ on: "2026-08-02" }), op({ on: "2026-09-14" }), op({ on: "2026-10-26" })],
      today,
      DEFAULT_DETECT,
    );
    expect(far).toEqual([]);
  });

  it("пропущенный месяц разрывает серию: считается только последний непрерывный отрезок", () => {
    const found = detect(
      [
        op({ on: "2026-04-09" }),
        op({ on: "2026-05-09" }),
        op({ on: "2026-07-09" }),
        op({ on: "2026-08-09" }),
      ],
      d("2026-08-20"),
      DEFAULT_DETECT,
    );
    expect(found).toEqual([]);
  });

  it("ежедневный кофе у одного получателя — не регулярный платёж", () => {
    const days = Array.from({ length: 20 }, (_, i) =>
      op({ on: `2026-10-${String(i + 1).padStart(2, "0")}`, amountMinor: 650 }),
    );
    expect(detect(days, today, DEFAULT_DETECT)).toEqual([]);
  });

  it("31-е число в коротком месяце сходится: 31.07 · 31.08 · 30.09", () => {
    const found = detect(
      [op({ on: "2026-07-31" }), op({ on: "2026-08-31" }), op({ on: "2026-09-30" })],
      d("2026-10-05"),
      DEFAULT_DETECT,
    );
    expect(found[0]).toMatchObject({ period: "month", nextExpectedOn: "2026-10-31" });
  });

  it("расходы и доходы одного получателя — разные серии", () => {
    const rows = ["2026-08-09", "2026-09-09", "2026-10-09"];
    const found = detect(
      [
        ...rows.map((on) => op({ on, flow: "expense" })),
        ...rows.map((on) => op({ on, flow: "income" })),
      ],
      today,
      DEFAULT_DETECT,
    );
    expect(found.map((f) => f.flow).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "expense",
      "income",
    ]);
  });
});

describe("REC-01: аванс и зарплата одного нанимателя", () => {
  it("две серии по сумме: 10-го по 960,00 и 25-го по 1 440,00", () => {
    const rows = [
      ...["2026-08-10", "2026-09-10", "2026-10-10"].map((on) =>
        op({ on, flow: "income", merchantKey: "employer", amountMinor: 96_000 }),
      ),
      ...["2026-08-25", "2026-09-25", "2026-10-25"].map((on) =>
        op({ on, flow: "income", merchantKey: "employer", amountMinor: 144_000 }),
      ),
    ];
    const found = detect(rows, today, DEFAULT_DETECT);
    expect(found.map((f) => f.anchorDay).toSorted((a, b) => (a ?? 0) - (b ?? 0))).toEqual([10, 25]);
  });
});

describe("REC-01: другие периоды", () => {
  it("неделя: три платежа через 7 дней", () => {
    const found = detect(
      [op({ on: "2026-10-05" }), op({ on: "2026-10-12" }), op({ on: "2026-10-19" })],
      today,
      DEFAULT_DETECT,
    );
    expect(found[0]).toMatchObject({ period: "week", nextExpectedOn: "2026-10-26" });
  });

  it("квартал: три платежа через 3 месяца", () => {
    const found = detect(
      [op({ on: "2026-01-15" }), op({ on: "2026-04-15" }), op({ on: "2026-07-15" })],
      d("2026-10-01"),
      DEFAULT_DETECT,
    );
    expect(found[0]).toMatchObject({ period: "quarter", nextExpectedOn: "2026-10-15" });
  });

  it("год: хватает двух повторов", () => {
    const found = detect(
      [op({ on: "2025-11-03" }), op({ on: "2026-11-03" })],
      d("2026-11-10"),
      DEFAULT_DETECT,
    );
    expect(found[0]).toMatchObject({ period: "year", nextExpectedOn: "2027-11-03" });
  });
});

describe("REC-01: давно прекратившееся не предлагается", () => {
  it("последний платёж больше двух периодов назад — серия мертва", () => {
    const found = detect(
      [op({ on: "2026-01-09" }), op({ on: "2026-02-09" }), op({ on: "2026-03-09" })],
      today,
      DEFAULT_DETECT,
    );
    expect(found).toEqual([]);
  });
});

describe("REC-01: основание — последние операции серии", () => {
  it("берутся не больше окна последних повторов, категория — последняя", () => {
    const months = [
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ];
    const found = detect(
      months.map((m, i) =>
        op({ on: `${m}-09`, categoryCode: i === 7 ? "subscriptions" : "other" }),
      ),
      today,
      { ...DEFAULT_DETECT, window: 6 },
    );
    expect(found[0]?.occurrences).toHaveLength(6);
    expect(found[0]?.memberIds).toHaveLength(8);
    expect(found[0]?.categoryCode).toBe("subscriptions");
  });
});
