// Скан выписки (T-025): страница рисуется контурами букв шрифта DejaVu (fontkit) в SVG, SVG растеризует sharp, затем
// небольшой наклон и размытие — как у фото листа. Без шума случайности: результат повторяем бит в бит. Скан — PNG
// (картинка-файл) или PDF без текстового слоя, куда эта картинка вложена.
import { openSync } from "fontkit";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { FONT_FILE } from "./render-table.ts";

const font = openSync(FONT_FILE);
if (!("layout" in font)) throw new Error("Ожидался одиночный шрифт, а не коллекция.");

export interface ScanPage {
  readonly title: readonly string[];
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Ширины колонок в пикселях и выравнивание. */
  readonly columns: readonly { readonly width: number; readonly align: "left" | "right" }[];
}

const WIDTH = 1240;
const LINE = 38;
const SIZE = 22;
const LEFT = 60;

/** Строка → контуры букв: SVG-фрагмент с началом в (x, y) по базовой линии. */
function textPath(
  text: string,
  x: number,
  y: number,
  align: "left" | "right",
  width: number,
): string {
  if (!("layout" in font)) return "";
  const run = font.layout(text);
  const scale = SIZE / font.unitsPerEm;
  const advance = run.positions.reduce((acc, p) => acc + p.xAdvance, 0) * scale;
  let pen = align === "right" ? x + width - advance : x;
  const parts: string[] = [];
  run.glyphs.forEach((glyph, i) => {
    const d = glyph.path.toSVG();
    if (d !== "") {
      parts.push(
        `<path transform="translate(${pen.toFixed(2)} ${y}) scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})" d="${d}"/>`,
      );
    }
    pen += (run.positions[i]?.xAdvance ?? 0) * scale;
  });
  return parts.join("");
}

export async function renderScanPng(page: ScanPage): Promise<Uint8Array> {
  const parts: string[] = [];
  let y = 90;
  for (const line of page.title) {
    parts.push(textPath(line, LEFT, y, "left", 0));
    y += LINE;
  }
  y += 24;
  const xs = page.columns.map((_, i) =>
    page.columns.slice(0, i).reduce((acc, c) => acc + c.width, LEFT),
  );
  const drawRow = (cells: readonly string[]) => {
    cells.forEach((cell, i) => {
      const column = page.columns[i];
      const x = xs[i];
      if (column !== undefined && x !== undefined) {
        parts.push(textPath(cell, x, y, column.align, column.width - 10));
      }
    });
    y += LINE;
  };
  drawRow(page.header);
  parts.push(`<rect x="${LEFT}" y="${y - LINE + 8}" width="${WIDTH - 2 * LEFT}" height="2"/>`);
  for (const row of page.rows) drawRow(row);
  const height = y + 90;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}"><rect width="100%" height="100%" fill="#fbfbf7"/><g fill="#1b1b1b">${parts.join("")}</g></svg>`;
  const png = await sharp(Buffer.from(svg))
    .rotate(0.4, { background: "#fbfbf7" })
    .blur(0.5)
    .grayscale()
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(png);
}

/** PDF без текстового слоя: одна страница, на ней только картинка скана. */
export async function renderScanPdf(png: Uint8Array): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    info: { Title: "Скан выписки", CreationDate: new Date("2026-10-29T00:00:00Z") },
  });
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  doc.image(Buffer.from(png), 0, 0, { fit: [595, 842] });
  const finished = new Promise<void>((resolve) => doc.on("end", resolve));
  doc.end();
  await finished;
  return new Uint8Array(Buffer.concat(chunks));
}
