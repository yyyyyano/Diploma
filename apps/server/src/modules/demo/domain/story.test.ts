// DEMO-01, DEMO-02: история демо — воспроизводима (одинаковые зерно и день → одинаковая), привязана к «сегодня», содержит всё,
// что перечислено в DEMO-01, и сходится по остаткам. Чистая функция: ни БД, ни времени, ни модели.
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { yearsBetween } from "./dates.ts";
import {
  buildStory,
  CASH_TARGET,
  DEMO_USD_RATE,
  STORY_ACCOUNTS,
  type Story,
  type StoryOp,
} from "./story.ts";

const day = (text: string) => LocalDate.parse(text);
const TODAY = day("2026-10-21");

const net = (story: Story, account: StoryOp["account"]) =>
  story.ops
    .filter((op) => op.account === account)
    .reduce((sum, op) => sum + (op.direction === "in" ? op.minor : -op.minor), 0);

/** «12,50» → 1250. */
const minorOf = (text: string) => Math.round(Number(text.replace(",", ".")) * 100);

describe("DEMO-02: воспроизводимость и привязка к дню", () => {
  it("одинаковые зерно и день — одна и та же история, до последнего знака", () => {
    expect(JSON.stringify(buildStory({ today: TODAY }))).toBe(
      JSON.stringify(buildStory({ today: TODAY })),
    );
  });

  it("другое зерно даёт другую повседневную историю — зерно действительно участвует", () => {
    const a = buildStory({ today: TODAY, seed: 1 });
    const b = buildStory({ today: TODAY, seed: 2 });
    expect(JSON.stringify(a.ops)).not.toBe(JSON.stringify(b.ops));
  });

  it("история — последние 6 месяцев до сегодня: ни одной операции в будущем и раньше начала, операции есть в каждом из шести месяцев", () => {
    for (const today of [
      day("2026-10-21"),
      day("2027-03-01"),
      day("2028-02-29"),
      day("2026-12-31"),
    ]) {
      const story = buildStory({ today });
      expect(story.start).toBe(LocalDate.addDays(shiftBack(today), 1));
      expect(story.ops.every((op) => op.on >= story.start && op.on <= today)).toBe(true);
      const months = new Set(story.ops.map((op) => op.on.slice(0, 7)));
      expect(months.size).toBeGreaterThanOrEqual(6);
    }
  });

  it("сдвиг сегодняшнего дня сдвигает чеки и цели: даты чеков — от сегодня, сроки целей — вперёд", () => {
    const a = buildStory({ today: day("2026-10-21") });
    const b = buildStory({ today: day("2026-11-21") });
    expect(a.receipts.map((r) => LocalDate.daysBetween(r.on, a.today))).toEqual(
      b.receipts.map((r) => LocalDate.daysBetween(r.on, b.today)),
    );
    expect(a.goals[0]?.deadline).toBe("2027-05-21");
    expect(b.goals[0]?.deadline).toBe("2027-06-21");
  });
});

describe("DEMO-01: состав истории", () => {
  const story = buildStory({ today: TODAY });

  it("зарплата и аванс в каждом полном месяце, кредит 410,00 и подписки 15,99 / 12,99 / 9,49", () => {
    const by = (description: string) => story.ops.filter((op) => op.description === description);
    expect(by("ООО «ТехноСофт» зарплата").map((op) => op.minor)).toEqual(
      Array(by("ООО «ТехноСофт» зарплата").length).fill(144_000),
    );
    expect(by("ООО «ТехноСофт» зарплата").length).toBeGreaterThanOrEqual(5);
    expect(by("ООО «ТехноСофт» аванс").length).toBeGreaterThanOrEqual(5);
    expect(by("Беларусбанк кредит погашение").every((op) => op.minor === 41_000)).toBe(true);
    expect([1599, 1299, 949].every((minor) => story.ops.some((op) => op.minor === minor))).toBe(
      true,
    );
  });

  it("переводы на накопительный — парами: у каждой «входящей» ноги есть исходящая с той же суммой и днём", () => {
    const byKey = new Map(story.ops.map((op) => [op.key, op]));
    const legs = story.ops.filter((op) => op.pairOf !== undefined);
    expect(legs.length).toBeGreaterThanOrEqual(5);
    for (const leg of legs) {
      const out = byKey.get(leg.pairOf ?? "");
      expect(out).toMatchObject({ account: "main", direction: "out", type: "transfer" });
      expect(out?.minor).toBe(leg.minor);
      expect(out?.on).toBe(leg.on);
      expect(leg).toMatchObject({ account: "savings", direction: "in" });
    }
  });

  it("снятия наличных — со встречной операцией на «Наличные»; валютные операции — в долларах по курсу демо", () => {
    expect(story.ops.filter((op) => op.cashCounterpart === true).length).toBeGreaterThanOrEqual(5);
    const usd = story.ops.filter((op) => op.currency === "USD");
    expect(usd.length).toBeGreaterThanOrEqual(5);
    expect(usd.every((op) => op.bynMinor === Math.round(op.minor * DEMO_USD_RATE))).toBe(true);
    expect(usd.every((op) => op.account === "alfa")).toBe(true);
  });

  it("возврат ссылается на существующую покупку того же счёта, не раньше неё и не больше её", () => {
    const refunds = story.ops.filter((op) => op.type === "refund");
    expect(refunds).toHaveLength(1);
    const purchase = story.ops.find((op) => op.key === refunds[0]?.refundOf);
    expect(purchase).toMatchObject({ type: "expense", account: refunds[0]?.account });
    expect(purchase?.on && refunds[0]?.on && purchase.on <= refunds[0].on).toBe(true);
    expect(refunds[0]?.minor).toBeLessThanOrEqual(purchase?.minor ?? 0);
  });

  it("оплата обучения БГУ 2 000,00 (вычет), ОСАГО страховщику (календарь), покупка техники (гарантия)", () => {
    expect(story.ops.find((op) => op.description === "Оплата обучения БГУ")).toMatchObject({
      minor: 200_000,
      category: "education",
    });
    expect(story.ops.find((op) => op.description.includes("ОСАГО"))).toBeDefined();
    expect(story.ops.find((op) => op.category === "electronics")).toBeDefined();
  });

  it("фитнес-клуб перестал приходить, кружок — три последних месяца", () => {
    const fitness = story.ops.filter((op) => op.description.startsWith("Фитнес-клуб"));
    expect(fitness.length).toBeGreaterThanOrEqual(3);
    expect(fitness.every((op) => LocalDate.daysBetween(op.on, TODAY) > 45)).toBe(true);
    const circle = story.ops.filter((op) => op.description.startsWith("Кружок"));
    expect(circle.length).toBeLessThanOrEqual(4);
    expect(circle.length).toBeGreaterThanOrEqual(3);
  });

  it("каждая операция расходов и доходов имеет встроенную категорию, у перевода категории нет; суммы — целые копейки", () => {
    const badAmounts = story.ops.filter((op) => !Number.isInteger(op.minor) || op.minor <= 0);
    const badCategory = story.ops.filter(
      (op) => (op.type === "transfer") !== (op.category === null),
    );
    expect(badAmounts).toEqual([]);
    expect(badCategory).toEqual([]);
  });

  it("двое детей: Максиму 17, Алисе 9 на день показа — в любой год", () => {
    for (const today of [TODAY, day("2027-06-30"), day("2029-01-02")]) {
      const { children } = buildStory({ today });
      expect(children.map((c) => [c.name, yearsBetween(c.birthDate, today)])).toEqual([
        ["Максим", 17],
        ["Алиса", 9],
      ]);
    }
  });
});

describe("DEMO-01: остатки счетов сходятся с целью", () => {
  it("начальный остаток + движение по истории = остаток на сегодня у каждого счёта и у «Наличных»", () => {
    const story = buildStory({ today: TODAY });
    for (const account of STORY_ACCOUNTS) {
      expect(story.openings[account.key] + net(story, account.key)).toBe(account.target);
    }
    const withdrawals = story.ops
      .filter((op) => op.cashCounterpart === true)
      .reduce((sum, op) => sum + op.minor, 0);
    const cashReceipts = story.receipts
      .filter((r) => r.payment === "cash")
      .reduce((sum, r) => sum + r.totalMinor, 0);
    expect(story.openings.cash + withdrawals - cashReceipts).toBe(CASH_TARGET);
  });
});

describe("DEMO-01: чеки", () => {
  const story = buildStory({ today: TODAY });
  const sumOf = (items: readonly { readonly lineTotal: string }[]) =>
    items.reduce((sum, item) => sum + minorOf(item.lineTotal), 0);

  it("пять чеков: сходящийся, с перепроверкой, «требует проверки», наличный и с гарантией", () => {
    expect(story.receipts.map((r) => r.key)).toEqual([
      "evroopt",
      "gippo",
      "korona",
      "belfarmaciya",
      "elektrosila",
    ]);
    expect(story.receipts.map((r) => r.payment)).toEqual(["card", "card", "card", "cash", "card"]);
  });

  it("Евроопт 10 позиций, итог 47,30 — строки сходятся с итогом", () => {
    const r = story.receipts[0];
    expect(r?.reading.items).toHaveLength(10);
    expect(sumOf(r?.reading.items ?? [])).toBe(4730);
    expect(minorOf(r?.reading.total ?? "")).toBe(4730);
    expect(r?.categories).toHaveLength(10);
  });

  it("Гиппо: строка 2 прочитана как 8,47, перепроверка называет 7,47 — после неё строки сходятся с итогом 34,45", () => {
    const r = story.receipts[1];
    expect(r?.reading.items[1]?.lineTotal).toBe("8,47");
    expect(r?.rechecks[0]?.lines).toEqual([
      { line: 2, quantity: "3", unitPrice: "2,49", discount: null, lineTotal: "7,47" },
    ]);
    expect(sumOf(r?.reading.items ?? []) - 847 + 747).toBe(3445);
  });

  it("Корона: 12 позиций, строки 5 и 9 не сходятся с «количество × цена», итог больше суммы строк на 1,37", () => {
    const r = story.receipts[2];
    expect(r?.reading.items).toHaveLength(12);
    const wrong = (r?.reading.items ?? []).flatMap((item, index) => {
      const gross = Math.round(Number(item.quantity.replace(",", ".")) * minorOf(item.unitPrice));
      return Math.abs(gross - minorOf(item.lineTotal)) > 1 ? [index + 1] : [];
    });
    expect(wrong).toEqual([5, 9]);
    expect(minorOf(r?.reading.total ?? "") - sumOf(r?.reading.items ?? [])).toBe(137);
  });

  it("у каждого чека категории — на каждую позицию, дата печатается ДД.ММ.ГГГГ от дня чека", () => {
    for (const r of story.receipts) {
      expect(r.categories).toHaveLength(r.reading.items.length);
      expect(r.reading.date).toBe(r.on.split("-").toReversed().join("."));
    }
  });
});

describe("DEMO-01: месяц показа не пуст, как бы рано в месяце ни был день", () => {
  it.each(["2026-10-01", "2026-10-02", "2026-10-21", "2026-10-31"])(
    "день %s: в текущем месяце есть траты на кафе, такси, продукты и развлечения — под лимиты",
    (text) => {
      const today = day(text);
      const story = buildStory({ today });
      const monthStart = `${text.slice(0, 7)}-01`;
      const inMonth = (category: string) =>
        story.ops.filter(
          (op) => op.category === category && op.on >= monthStart && op.direction === "out",
        );
      expect(inMonth("cafes").length).toBeGreaterThanOrEqual(3);
      expect(inMonth("taxi").length).toBeGreaterThanOrEqual(3);
      expect(inMonth("groceries").length).toBeGreaterThanOrEqual(3);
      expect(inMonth("leisure").length).toBeGreaterThanOrEqual(1);
    },
  );
});

/** Тот же день на 6 месяцев раньше (для проверки начала истории). */
function shiftBack(today: LocalDate): LocalDate {
  const [y = 0, m = 1, d = 1] = today.split("-").map(Number);
  const index = y * 12 + (m - 1) - 6;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return LocalDate.parse(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`,
  );
}
