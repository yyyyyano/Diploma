// STMT-09 на Postgres: курс НБРБ на день — из кэша currency_rates или из источника (фикстуры, без сети); выходной — последний
// установленный курс (шаг назад до настройки), на сегодня «вчерашний» курс не застревает в кэше; НБРБ недоступен —
// курса нет; BYN не запрашивается; пересчёт в BYN — с курсом в трассе.
import { node } from "@kosht/calc";
import { LocalDate, Money } from "@kosht/kernel";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { FxRate } from "../domain/fx-rate.ts";
import { saveRate } from "../infrastructure/db/fx-rates.repo.ts";
import type { FxRatesSource } from "./ports.ts";
import { makeRates } from "./rates.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

/** Источник-фикстура: курсы по дням, запросы записываются. */
function fixtureSource(days: Record<string, Omit<FxRate, "id"> | "fail">) {
  const calls: string[] = [];
  const source: FxRatesSource = {
    async rateOn(currency, day) {
      calls.push(`${currency}:${day}`);
      const found = days[`${currency}:${day}`];
      if (found === "fail") throw new Error("сеть");
      return found ?? null;
    },
  };
  return { source, calls };
}

const usd = (rateDate: string, rateE4 = 29_871) => ({
  currency: "USD",
  rateDate,
  rateE4,
  scale: 1,
});

function rates(source: FxRatesSource, lookback = 7) {
  const log = memoryLogger();
  return {
    rates: makeRates({
      system: createSystemDb(db.pool),
      source,
      clock: new FakeClock("2026-10-28T09:00:00Z"),
      settings: { get: async () => lookback as never },
      log: log.log,
    }),
    log,
  };
}

describe("STMT-09: курс НБРБ на день", () => {
  it("курс берётся из НБРБ один раз — дальше из кэша", async () => {
    const { source, calls } = fixtureSource({ "USD:2026-10-21": usd("2026-10-21") });
    const { rates: r } = rates(source);
    const first = await r.rateOn("USD", LocalDate.parse("2026-10-21"));
    const second = await r.rateOn("USD", LocalDate.parse("2026-10-21"));
    expect(first).toEqual({ id: expect.any(String), ...usd("2026-10-21") });
    expect(second).toEqual(first);
    expect(calls).toEqual(["USD:2026-10-21"]);
  });

  it("выходной — последний установленный курс (пятница), запомнен на воскресенье", async () => {
    const { source, calls } = fixtureSource({
      "EUR:2026-10-23": { ...usd("2026-10-23", 34_120), currency: "EUR" },
    });
    const { rates: r } = rates(source);
    expect(await r.rateOn("EUR", LocalDate.parse("2026-10-25"))).toMatchObject({
      currency: "EUR",
      rateDate: "2026-10-23",
      rateE4: 34_120,
    });
    await r.rateOn("EUR", LocalDate.parse("2026-10-25"));
    expect(calls).toEqual(["EUR:2026-10-25", "EUR:2026-10-24", "EUR:2026-10-23"]);
  });

  it("на сегодня курса ещё нет — вчерашний; следующий вопрос сегодня снова спрашивает НБРБ", async () => {
    const { source, calls } = fixtureSource({
      "PLN:2026-10-27": { ...usd("2026-10-27", 7_910), currency: "PLN" },
    });
    const { rates: r } = rates(source);
    const today = LocalDate.parse("2026-10-28");
    expect((await r.rateOn("PLN", today))?.rateDate).toBe("2026-10-27");
    await r.rateOn("PLN", today);
    expect(calls).toEqual(["PLN:2026-10-28", "PLN:2026-10-27", "PLN:2026-10-28", "PLN:2026-10-27"]);
  });

  it("за окно поиска курса нет или НБРБ недоступен — курса нет (undefined), в логе причина без данных", async () => {
    const empty = rates(fixtureSource({}).source, 2);
    expect(await empty.rates.rateOn("CNY", LocalDate.parse("2026-10-20"))).toBeUndefined();
    expect(empty.log.text()).toContain("fx.rate-missing");
    const down = rates(fixtureSource({ "GBP:2026-10-20": "fail" }).source);
    expect(await down.rates.rateOn("GBP", LocalDate.parse("2026-10-20"))).toBeUndefined();
    expect(down.log.text()).toContain("fx.rate-unavailable");
  });

  it("BYN к BYN не запрашивается", async () => {
    const { rates: r } = rates(fixtureSource({}).source);
    await expect(r.rateOn("BYN", LocalDate.parse("2026-10-20"))).rejects.toThrow(RangeError);
  });

  it("одновременная запись курса того же дня — одна строка, вернётся первая", async () => {
    const system = createSystemDb(db.pool);
    const at = new Date("2026-10-28T09:00:00Z");
    const a = await saveRate(system, "2026-10-01", usd("2026-10-01", 30_000), at);
    const b = await saveRate(system, "2026-10-01", usd("2026-10-01", 31_000), at);
    expect(b).toEqual(a);
  });
});

describe("STMT-09, КП STMT: сумма в BYN по курсу на дату — курс в трассе", () => {
  it("320,00 USD на 22.10 → 955,87 BYN, в трассе — ссылка на курс; BYN — без запроса; нет курса — undefined", async () => {
    const { source, calls } = fixtureSource({ "USD:2026-10-22": usd("2026-10-22") });
    const { rates: r } = rates(source);
    const day = LocalDate.parse("2026-10-22");
    const converted = await r.convert(
      "accounts.balanceInByn",
      node("accounts.balance", Money.of(32_000, "USD")),
      day,
    );
    expect(converted?.calc.value).toEqual({ minor: 95_587, currency: "BYN" });
    expect(converted?.calc.trace.inputs[1]?.refs).toEqual([
      { kind: "fxRate", id: converted?.rate?.id },
    ]);
    const byn = node("accounts.balance", Money.of(100, "BYN"));
    expect(await r.convert("x", byn, day)).toEqual({ calc: byn, rate: null });
    expect(await r.convert("x", node("accounts.balance", Money.of(1, "JPY")), day)).toBeUndefined();
    expect(calls.filter((call) => call.startsWith("USD"))).toEqual(["USD:2026-10-22"]);
  });
});
