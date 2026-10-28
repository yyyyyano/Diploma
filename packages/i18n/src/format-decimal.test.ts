// STMT-09: курс НБРБ для человека — «2,9871» из 29871 десятитысячных, без float.
import { describe, expect, it } from "vitest";
import { formatScaled } from "./format-decimal.ts";

describe("курс и доли — из целого", () => {
  it.each([
    [29_871, 4, "2,9871"],
    [36_432, 4, "3,6432"],
    [5, 4, "0,0005"],
    [-1_250, 2, "−12,50"],
    [7, 0, "7"],
  ])("%i с %i знаками → «%s»", (value, decimals, text) => {
    expect(formatScaled(value, decimals)).toBe(text);
  });

  it("дробь или отрицательное число знаков — ошибка программы", () => {
    expect(() => formatScaled(1.5, 2)).toThrow(RangeError);
    expect(() => formatScaled(1, -1)).toThrow(RangeError);
  });
});
