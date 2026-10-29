// STMT-03, STMT-04, SEC-03: чтение файлов выписок в изолированном потоке — на синтетическом наборе datasets/statements.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import yazl from "yazl";
import type { RawDocument } from "../../domain/types.ts";
import { DocumentReadError } from "../../application/ports.ts";
import { readDocument } from "./read-document.ts";
import { assertSafeZip, XLSX_ZIP_LIMITS } from "./zip-guard.ts";

const DATASET = fileURLToPath(
  new URL("../../../../../../../datasets/statements/", import.meta.url),
);
const limits = { timeoutMs: 30_000, memoryMb: 512 };

function fileOf(id: string): { type: "pdf" | "xlsx" | "xls" | "csv" | "png"; bytes: Uint8Array } {
  const name = readdirSync(join(DATASET, id)).find((file) => file.startsWith("statement."));
  if (name === undefined) throw new Error(`нет файла случая ${id}`);
  const type = name.split(".")[1] as "pdf" | "xlsx" | "xls" | "csv" | "png";
  return { type, bytes: new Uint8Array(readFileSync(join(DATASET, id, name))) };
}

async function tableOf(id: string) {
  const document: RawDocument = await readDocument(fileOf(id), limits);
  if (document.kind !== "table") throw new Error(`${id}: ожидалась таблица`);
  return document.table;
}

const texts = (line: { cells: readonly { text: string }[] }) => line.cells.map((c) => c.text);

describe("STMT-04: чтение файлов в песочнице", () => {
  it("CSV в utf-8 с BOM: шапка банка из одной ячейки и таблица через «;»", async () => {
    const table = await tableOf("lesbank-csv-september");
    expect(table.kind).toBe("csv");
    expect(texts(table.lines[0]!)).toEqual(["Лесбанк"]);
    expect(texts(table.lines[3]!)).toEqual([
      "Дата",
      "Описание операции",
      "Приход",
      "Расход",
      "Остаток",
    ]);
    expect(table.lines).toHaveLength(3 + 1 + 30);
  });

  it("CSV в windows-1251 читается как русский текст, а не «кракозябры»", async () => {
    const table = await tableOf("yantar-csv-cp1251");
    expect(texts(table.lines[0]!)).toEqual([
      "Дата операции",
      "Время",
      "Назначение платежа",
      "Сумма",
      "Валюта",
    ]);
  });

  it("XLSX: даты — ISO, числа — каноническим десятичным видом, шапка банка над таблицей", async () => {
    const table = await tableOf("puschabank-xlsx");
    expect(table.kind).toBe("xlsx");
    expect(table.lines.some((line) => texts(line).join(" ").includes("Остаток на начало"))).toBe(
      true,
    );
    const header = table.lines.findIndex((line) => texts(line)[0] === "Дата");
    const first = texts(table.lines[header + 1]!);
    expect(first[0]).toBe("2026-09-01");
    expect(first[2]).toMatch(/^\d+(\.\d{2})?$|^$/);
  });

  it("XLS (BIFF8) читается так же, как XLSX", async () => {
    const table = await tableOf("hamlet-xls-english");
    expect(table.kind).toBe("xls");
    const header = table.lines.findIndex((line) => texts(line)[0] === "Date");
    expect(texts(table.lines[header]!)).toEqual(["Date", "Details", "Amount", "Balance"]);
    expect(table.lines.length - header - 1).toBe(30);
  });

  it("PDF на 3 страницах: слова собраны в ячейки с координатами, страницы и позиции строк известны", async () => {
    const table = await tableOf("lesbank-pdf-multipage");
    expect(table.kind).toBe("pdf");
    expect(new Set(table.lines.map((line) => line.page))).toEqual(new Set([1, 2, 3]));
    const header = table.lines.find((line) => texts(line)[0] === "Дата");
    expect(texts(header!)).toEqual(["Дата", "Описание", "Сумма", "Остаток"]);
    expect(header?.cells[2]?.x1).toBeGreaterThan(header?.cells[1]?.x1 ?? 0);
    const wrapped = table.lines.find((line) => texts(line)[0]?.startsWith("LITSEVOY SCHET"));
    expect(wrapped?.cells).toHaveLength(1);
  });

  it("скан-PDF без текстового слоя отдаёт картинку страницы (unpdf + sharp), PNG-скан — саму картинку", async () => {
    const fromPdf = await readDocument(fileOf("scan-pdf"), limits);
    expect(fromPdf.kind).toBe("images");
    if (fromPdf.kind !== "images") return;
    expect(fromPdf.images[0]?.mime).toBe("image/png");
    expect(Array.from(fromPdf.images[0]?.bytes.subarray(0, 4) ?? [])).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);
    const fromPng = await readDocument(fileOf("scan-png"), limits);
    expect(fromPng).toMatchObject({ kind: "images", images: [{ mime: "image/png" }] });
  });

  it("байты вызывающего после чтения целы: потоку уходит копия, буфер не отсоединяется", async () => {
    const file = fileOf("lesbank-csv-september");
    await readDocument(file, limits);
    expect(file.bytes.byteLength).toBeGreaterThan(0);
    await expect(readDocument(file, limits)).resolves.toMatchObject({ kind: "table" });
  });

  it("битый PDF — отказ «unreadable», а не падение процесса", async () => {
    const error = await readDocument(
      { type: "pdf", bytes: new TextEncoder().encode("%PDF-1.4\nмусор") },
      limits,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocumentReadError);
    expect(error).toMatchObject({ reason: "unreadable" });
  });

  it("битый XLSX (не архив) — «unreadable»", async () => {
    await expect(
      readDocument({ type: "xlsx", bytes: new TextEncoder().encode("PK не архив") }, limits),
    ).rejects.toMatchObject({ reason: "unreadable" });
  });
});

/** ZIP с одним файлом нулей заданного размера: сжимается в сотни раз — «бомба». */
function zipOfZeros(size: number): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.alloc(size), "xl/worksheets/sheet1.xml");
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    zip.end();
  });
}

describe("SEC-03: защита от ZIP-бомб до SheetJS", () => {
  it("архив, раздувающийся в сотни раз, отклоняется по коэффициенту сжатия", async () => {
    const bomb = await zipOfZeros(50 * 1024 * 1024);
    expect(bomb.byteLength).toBeLessThan(200 * 1024);
    expect(() => assertSafeZip(bomb)).toThrowError(/zip-bomb/);
  });

  it("суммарный несжатый размер больше предела — отказ", async () => {
    const big = await zipOfZeros(8 * 1024 * 1024);
    expect(() =>
      assertSafeZip(big, { ...XLSX_ZIP_LIMITS, maxUncompressed: 1024 * 1024 }),
    ).toThrowError(/zip-bomb/);
  });

  it("слишком много файлов в архиве — отказ", async () => {
    const zip = new yazl.ZipFile();
    for (let i = 0; i < 12; i++) zip.addBuffer(Buffer.from("x"), `f${i}.xml`);
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve) => zip.outputStream.on("end", () => resolve()));
    zip.end();
    await done;
    expect(() =>
      assertSafeZip(new Uint8Array(Buffer.concat(chunks)), { ...XLSX_ZIP_LIMITS, maxEntries: 10 }),
    ).toThrowError(/zip-bomb/);
  });

  it("настоящая выписка XLSX проходит защиту", () => {
    expect(() => assertSafeZip(fileOf("puschabank-xlsx").bytes)).not.toThrow();
  });

  it("бомба внутри XLSX-файла: чтение в песочнице отвечает «zip-bomb» и не раздувает память процесса", async () => {
    const bomb = await zipOfZeros(50 * 1024 * 1024);
    await expect(readDocument({ type: "xlsx", bytes: bomb }, limits)).rejects.toMatchObject({
      reason: "zip-bomb",
    });
  });

  it("не архив — «unreadable»", () => {
    expect(() => assertSafeZip(new Uint8Array(10))).toThrowError(/unreadable/);
  });
});
