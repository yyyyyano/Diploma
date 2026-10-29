// ADM-20, DES-17: запись чисел «Запросов к ИИ» — токены, стоимость, время, доля, цена в прайс-листе.
import { describe, expect, it } from "vitest";
import {
  dollarsToMicros,
  formatCostMicros,
  formatMs,
  formatPermille,
  formatTokens,
  groupDigits,
  microsToDollars,
} from "./ai-format.ts";

const units = { million: "млн", thousand: "тыс.", second: "с", millisecond: "мс" };
const nbsp = String.fromCharCode(0xa0);

describe("токены", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [9999, "9" + nbsp + "999"],
    [128_000, "128" + nbsp + "тыс."],
    [1_240_000, "1,24" + nbsp + "млн"],
  ])("%i → «%s»", (tokens, text) => {
    expect(formatTokens(tokens, units)).toBe(text);
  });

  it("разряды целого", () => {
    expect(groupDigits(1_234_567)).toBe(["1", "234", "567"].join(nbsp));
  });
});

describe("стоимость, время, доля", () => {
  it("условная стоимость в долларах; меньше цента — «< $0,01»; ноль — $0,00", () => {
    expect(formatCostMicros(840_000)).toBe("$0,84");
    expect(formatCostMicros(2955)).toBe("<" + nbsp + "$0,01");
    expect(formatCostMicros(0)).toBe("$0,00");
  });

  it("время ответа: миллисекунды, секунды с десятыми, нет данных — тире", () => {
    expect(formatMs(850, units)).toBe("850" + nbsp + "мс");
    expect(formatMs(2100, units)).toBe("2,1" + nbsp + "с");
    expect(formatMs(null, units)).toBe("—");
  });

  it("доля ошибок из промилле", () => {
    expect(formatPermille(14)).toBe("1,4" + nbsp + "%");
    expect(formatPermille(0)).toBe("0,0" + nbsp + "%");
  });
});

describe("ADM-21: цена в прайс-листе — доллары за миллион токенов ↔ микродоллары", () => {
  it("микродоллары → «0,59»; ноль — «0»", () => {
    expect(microsToDollars(590_000)).toBe("0,59");
    expect(microsToDollars(2_000_000)).toBe("2");
    expect(microsToDollars(0)).toBe("0");
  });

  it("ввод с запятой или точкой → микродоллары; не число — undefined", () => {
    expect(dollarsToMicros("0,59")).toBe(590_000);
    expect(dollarsToMicros("0.79")).toBe(790_000);
    expect(dollarsToMicros("2")).toBe(2_000_000);
    expect(dollarsToMicros("0,0000015")).toBeUndefined();
    expect(dollarsToMicros("abc")).toBeUndefined();
    expect(dollarsToMicros("")).toBeUndefined();
  });
});
