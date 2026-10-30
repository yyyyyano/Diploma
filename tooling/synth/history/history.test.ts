// T-030, REC-01: синтетическая история детерминирована, регулярные платежи в ней известны заранее.
import { describe, expect, it } from "vitest";
import { generateHistory } from "./history.ts";

describe("синтетическая история на 6 месяцев", () => {
  it("одно зерно — одна история", () => {
    expect(generateHistory({ seed: 7, today: "2026-10-28" })).toEqual(
      generateHistory({ seed: 7, today: "2026-10-28" }),
    );
  });

  it("у каждого регулярного платежа 6–7 повторов, у прекратившегося — меньше и последний раньше", () => {
    const { expected } = generateHistory({ seed: 7, today: "2026-10-28" });
    const salary = expected.find((e) => e.merchant.includes("ТехноСофт") && e.day === 25);
    const club = expected.find((e) => e.merchant.includes("Атлетик"));
    expect(salary?.repeats).toBe(7);
    expect(club?.repeats).toBe(6);
    expect(club && club.lastDate < "2026-10-12").toBe(true);
  });

  it("шум не регулярный: кофе почти каждый день есть в истории", () => {
    const { operations } = generateHistory({ seed: 7, today: "2026-10-28" });
    expect(operations.filter((o) => o.merchant.includes("Зерно")).length).toBeGreaterThan(100);
  });
});
