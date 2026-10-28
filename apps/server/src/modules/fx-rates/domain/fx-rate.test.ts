// STMT-09: разбор курса НБРБ без float и шаг назад по календарю.
import { describe, expect, it } from "vitest";
import { fromNbrb, previousDay } from "./fx-rate.ts";

const usd = {
  Cur_Abbreviation: "USD",
  Cur_Scale: 1,
  Cur_OfficialRate: 2.9871,
  Date: "2026-10-21T00:00:00",
};

describe("STMT-09: курс НБРБ в десятитысячных", () => {
  it("USD 2,9871 → 29871 за 1; RUB 3,6432 за 100 → 36432 и масштаб 100", () => {
    expect(fromNbrb(usd)).toEqual({
      currency: "USD",
      rateDate: "2026-10-21",
      rateE4: 29_871,
      scale: 1,
    });
    expect(
      fromNbrb({ ...usd, Cur_Abbreviation: "RUB", Cur_Scale: 100, Cur_OfficialRate: 3.6432 }),
    ).toMatchObject({
      rateE4: 36_432,
      scale: 100,
    });
  });

  it("целый курс и курс с одним знаком — без потерь", () => {
    expect(fromNbrb({ ...usd, Cur_OfficialRate: 3 })?.rateE4).toBe(30_000);
    expect(fromNbrb({ ...usd, Cur_OfficialRate: 3.5 })?.rateE4).toBe(35_000);
  });

  it("больше четырёх знаков — не по формату", () => {
    expect(fromNbrb({ ...usd, Cur_OfficialRate: 2.98712 })).toBeNull();
  });
});

describe("шаг назад по календарю", () => {
  it("через начало месяца и года", () => {
    expect(previousDay("2026-10-19")).toBe("2026-10-18");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2027-01-01")).toBe("2026-12-31");
  });
});
