// AUTH-05: код восстановления — 16 знаков без I, L, O, U группами по 4; ввод прощает регистр, пробелы, дефисы и
// путаницу O/0, I/L/1; чужие знаки и не та длина — не код.
import { describe, expect, it } from "vitest";
import { formatRecoveryCode, normalizeRecoveryCode } from "./recovery-code.ts";

describe("AUTH-05: код восстановления", () => {
  it("10 байт — «XXXX-XXXX-XXXX-XXXX» из алфавита без I, L, O, U", () => {
    const code = formatRecoveryCode(Uint8Array.from([0, 1, 2, 3, 4, 250, 251, 252, 253, 255]));
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(formatRecoveryCode(new Uint8Array(10))).toBe("0000-0000-0000-0000");
    expect(formatRecoveryCode(new Uint8Array(10).fill(255))).toBe("ZZZZ-ZZZZ-ZZZZ-ZZZZ");
  });

  it("не 10 байт — ошибка программы", () => {
    expect(() => formatRecoveryCode(new Uint8Array(9))).toThrow(RangeError);
  });

  it("ввод нормализуется: регистр, пробелы, дефисы, O → 0, I и L → 1", () => {
    expect(normalizeRecoveryCode(" kq7m-4xpd 9tjc-2hwr ")).toBe("KQ7M4XPD9TJC2HWR");
    expect(normalizeRecoveryCode("OOOO-IIII-LLLL-0000")).toBe("0000111111110000");
  });

  it("не та длина или знак вне алфавита (U) — не код", () => {
    expect(normalizeRecoveryCode("KQ7M-4XPD-9TJC")).toBeUndefined();
    expect(normalizeRecoveryCode("KQ7M-4XPD-9TJC-2HWU")).toBeUndefined();
  });
});
