// Рисование таблицы выписки в файл: CSV (utf-8 с BOM и cp1251), XLSX и XLS (SheetJS), PDF (pdfkit, кириллический TTF).
// Вход — одна и та же раскладка: строки до шапки (шапка банка), шапка таблицы и строки данных. Только dev (tooling).
import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

/** Ячейка: текст как есть, число (числовая ячейка Excel) или дата Excel. */
export type Cell = string | number | { readonly date: string };

export interface PdfColumn {
  readonly width: number;
  readonly align: "left" | "right";
}

export interface TableLayout {
  /** Строки до шапки таблицы: название банка, счёт, период, остатки. */
  readonly preamble: readonly (readonly Cell[])[];
  readonly header: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
  /** Только PDF: ширина и выравнивание колонок. */
  readonly pdfColumns?: readonly PdfColumn[];
}

export const FONT_FILE = fileURLToPath(
  new URL("../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf", import.meta.url),
);

function cellText(cell: Cell): string {
  if (typeof cell === "string") return cell;
  if (typeof cell === "number") return String(cell);
  return cell.date;
}

function csvField(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Windows-1251 без iconv: ASCII, кириллица, «Ёё», «№», кавычки-ёлочки и тире. */
export function encodeCp1251(text: string): Uint8Array {
  const special: Record<string, number> = {
    Ё: 0xa8,
    ё: 0xb8,
    "№": 0xb9,
    "«": 0xab,
    "»": 0xbb,
    "–": 0x96,
    "—": 0x97,
    " ": 0xa0,
  };
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) out.push(code);
    else if (special[char] !== undefined) out.push(special[char]);
    else if (code >= 0x410 && code <= 0x44f) out.push(code - 0x410 + 0xc0);
    else throw new RangeError(`Символ «${char}» не кодируется в windows-1251.`);
  }
  return Uint8Array.from(out);
}

export function renderCsv(layout: TableLayout, encoding: "utf-8-bom" | "windows-1251"): Uint8Array {
  const lines = [...layout.preamble, layout.header, ...layout.rows].map((row) =>
    row.map((cell) => csvField(cellText(cell))).join(";"),
  );
  const text = `${lines.join("\r\n")}\r\n`;
  if (encoding === "windows-1251") return encodeCp1251(text);
  return new Uint8Array(Buffer.from(`﻿${text}`, "utf8"));
}

export function renderSheet(layout: TableLayout, bookType: "xlsx" | "biff8"): Uint8Array {
  const aoa = [...layout.preamble, layout.header, ...layout.rows].map((row) =>
    row.map((cell) => (typeof cell === "object" ? new Date(`${cell.date}T00:00:00Z`) : cell)),
  );
  const sheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const book = XLSX.utils.book_new();
  // Фиксированная дата создания: иначе файл при каждой генерации другой.
  book.Props = { Title: "Синтетическая выписка", CreatedDate: new Date("2026-10-29T00:00:00Z") };
  XLSX.utils.book_append_sheet(book, sheet, "Выписка");
  const bytes = XLSX.write(book, { type: "buffer", bookType, cellDates: true }) as Buffer;
  return new Uint8Array(bytes);
}

const PAGE = { width: 595, height: 842, margin: 40 };
const ROW_HEIGHT = 15;
const FONT_SIZE = 9;

/** Разбить текст по словам на строки не шире width (для переноса описаний на вторую строку). */
function wrap(doc: PDFKit.PDFDocument, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (doc.widthOfString(candidate) > width && line !== "") {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** PDF с текстовым слоем: шапка банка на первой странице, шапка таблицы на каждой, «Страница N из M» внизу. */
export async function renderPdf(layout: TableLayout): Promise<Uint8Array> {
  const columns = layout.pdfColumns;
  if (columns === undefined) throw new Error("Для PDF нужны pdfColumns.");
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    // Нижнего поля нет: страницы переносит код ниже сам, а «Страница N из M» стоит у самого края.
    margins: { top: PAGE.margin, left: PAGE.margin, right: PAGE.margin, bottom: 0 },
    bufferPages: true,
    info: { Title: "Синтетическая выписка", CreationDate: new Date("2026-10-29T00:00:00Z") },
  });
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  doc.registerFont("body", readFileSync(FONT_FILE));
  doc.font("body").fontSize(FONT_SIZE);
  const xs = columns.map((_, i) =>
    columns.slice(0, i).reduce((acc, column) => acc + column.width, PAGE.margin),
  );
  // Колонка описания — самая широкая слева: туда переносятся длинные строки.
  const wrapIndex = columns.reduce(
    (best, column, i) =>
      column.align === "left" && column.width > (columns[best]?.width ?? 0) ? i : best,
    0,
  );
  const drawRow = (cells: readonly string[], y: number) => {
    cells.forEach((text, i) => {
      const column = columns[i];
      const x = xs[i];
      if (column === undefined || x === undefined) return;
      doc.text(text, x, y, { width: column.width - 6, align: column.align, lineBreak: false });
    });
  };
  let y = PAGE.margin;
  const bottom = PAGE.height - PAGE.margin - 20;
  const header = () => {
    doc.font("body").fontSize(FONT_SIZE);
    drawRow(layout.header, y);
    y += ROW_HEIGHT + 4;
  };
  for (const row of layout.preamble) {
    doc.text(row.map(cellText).join("  "), PAGE.margin, y, { lineBreak: false });
    y += ROW_HEIGHT;
  }
  y += 6;
  header();
  for (const row of layout.rows) {
    const texts = row.map(cellText);
    const description = texts[wrapIndex] ?? "";
    const lines = wrap(doc, description, (columns[wrapIndex]?.width ?? 100) - 8);
    const height = lines.length * ROW_HEIGHT;
    if (y + height > bottom) {
      doc.addPage();
      y = PAGE.margin;
      header();
    }
    drawRow(
      texts.map((text, i) => (i === wrapIndex ? (lines[0] ?? "") : text)),
      y,
    );
    // Перенос: остаток описания — второй строкой только в колонке описания, без даты и сумм.
    for (const [offset, line] of lines.slice(1).entries()) {
      doc.text(line, xs[wrapIndex] ?? PAGE.margin, y + (offset + 1) * ROW_HEIGHT, {
        lineBreak: false,
      });
    }
    y += height;
  }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.text(`Страница ${i + 1} из ${range.count}`, PAGE.margin, PAGE.height - PAGE.margin, {
      lineBreak: false,
    });
  }
  const finished = new Promise<void>((resolve) => doc.on("end", resolve));
  doc.end();
  await finished;
  return new Uint8Array(Buffer.concat(chunks));
}
