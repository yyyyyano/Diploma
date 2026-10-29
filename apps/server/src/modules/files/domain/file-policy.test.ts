// SEC-03: тип по содержимому и белый список; подменённое расширение отклоняется.
import { describe, expect, it } from "vitest";
import { extensionOf, judgeFile, looksLikeText } from "./file-policy.ts";

describe("SEC-03: белый список типов", () => {
  it("PDF под именем .pdf принимается как выписка", () => {
    expect(judgeFile("statement", "Выписка.pdf", "pdf", false)).toMatchObject({
      ok: true,
      mime: "application/pdf",
    });
  });

  it("PDF, переименованный в .csv, отклоняется как подмена расширения", () => {
    expect(judgeFile("statement", "выписка.csv", "pdf", false)).toEqual({
      ok: false,
      reason: "extension",
    });
  });

  it("фото PNG под именем .jpg — подмена: расширение не от PNG", () => {
    expect(judgeFile("receipt-photo", "чек.jpg", "png", false)).toEqual({
      ok: false,
      reason: "extension",
    });
  });

  it("исполняемый файл под именем .pdf: сигнатуры из списка нет и текстом он не выглядит — тип не разрешён", () => {
    expect(judgeFile("statement", "выписка.pdf", undefined, false)).toEqual({
      ok: false,
      reason: "type",
    });
  });

  it("текст без сигнатуры — CSV, если имя .csv или .txt или без расширения", () => {
    expect(judgeFile("statement", "operations.csv", undefined, true)).toMatchObject({
      ok: true,
      type: "csv",
    });
    expect(judgeFile("statement", "operations.txt", undefined, true).ok).toBe(true);
    expect(judgeFile("statement", "operations", undefined, true).ok).toBe(true);
  });

  it("текст под именем .pdf или .exe — подмена", () => {
    expect(judgeFile("statement", "a.pdf", undefined, true)).toEqual({
      ok: false,
      reason: "extension",
    });
    expect(judgeFile("statement", "a.exe", undefined, true)).toEqual({
      ok: false,
      reason: "extension",
    });
  });

  it("фото чека не принимает PDF и Excel: белый список зависит от вида", () => {
    expect(judgeFile("receipt-photo", "x.pdf", "pdf", false)).toEqual({
      ok: false,
      reason: "type",
    });
    expect(judgeFile("receipt-photo", "x.xlsx", "xlsx", false)).toEqual({
      ok: false,
      reason: "type",
    });
    expect(judgeFile("receipt-photo", "чек.heic", "heic", false).ok).toBe(true);
  });

  it("скан выписки — фото страницы — принимается как выписка", () => {
    expect(judgeFile("statement", "скан.jpeg", "jpg", false)).toMatchObject({
      ok: true,
      type: "jpg",
    });
  });

  it("Excel .xls и .xlsx принимаются, документ Word под именем .xlsx — нет (тип не в списке)", () => {
    expect(judgeFile("statement", "a.xls", "xls", false).ok).toBe(true);
    expect(judgeFile("statement", "a.xlsx", "xlsx", false).ok).toBe(true);
    expect(judgeFile("statement", "a.xlsx", undefined, false)).toEqual({
      ok: false,
      reason: "type",
    });
  });
});

describe("extensionOf и looksLikeText", () => {
  it("расширение — после последней точки, в нижнем регистре; у «.bashrc» и «имя» его нет", () => {
    expect(extensionOf("Выписка.PDF")).toBe("pdf");
    expect(extensionOf("a.tar.gz")).toBe("gz");
    expect(extensionOf(".bashrc")).toBe("");
    expect(extensionOf("имя")).toBe("");
    expect(extensionOf("папка/файл.csv")).toBe("csv");
  });

  it("нулевой байт и управляющие знаки — не текст; перевод строки и табуляция — текст", () => {
    expect(looksLikeText(new Uint8Array([0x61, 0x00, 0x62]))).toBe(false);
    expect(looksLikeText(new Uint8Array([0x61, 0x07]))).toBe(false);
    expect(looksLikeText(new TextEncoder().encode("дата;сумма\r\n1\t2\n"))).toBe(true);
    expect(looksLikeText(new Uint8Array())).toBe(false);
  });
});
