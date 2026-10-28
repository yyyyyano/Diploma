// DES-17, PRIV-05: размер файла для человека — «820 Б», «1,5 КБ», «18,4 МБ»: десятые через запятую, лишний «,0» не
// пишется, между числом и единицей неразрывный пробел (размер не рвётся переносом строки).
import { describe, expect, it } from "vitest";
import { formatFileSize } from "./format-file-size.ts";

const NBSP = String.fromCharCode(0x00a0);

describe("DES-17: formatFileSize", () => {
  it.each([
    [0, "0 Б"],
    [820, "820 Б"],
    [1023, "1023 Б"],
    [1024, "1 КБ"],
    [1536, "1,5 КБ"],
    [19_293_798, "18,4 МБ"],
    [1024 * 1024 - 1, "1 МБ"],
    [5 * 1024 ** 3, "5 ГБ"],
  ])("%d байт → %s", (bytes, text) => {
    expect(formatFileSize(bytes)).toBe(text.replace(" ", NBSP));
  });

  it("отрицательный или дробный размер — RangeError, а не неверная строка", () => {
    expect(() => formatFileSize(-1)).toThrow(RangeError);
    expect(() => formatFileSize(1.5)).toThrow(RangeError);
  });
});
