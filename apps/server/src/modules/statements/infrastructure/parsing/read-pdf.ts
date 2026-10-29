// PDF (STMT-04 шаг 1 и 4): текстовый слой — слова с координатами (unpdf), из них строки и ячейки; PDF без текста (скан)
// отдаёт картинки страниц — их читает модель с изображениями. Слова одной строки — общая вертикальная позиция; слова
// ближе половины высоты шрифта склеиваются в одну ячейку (пробелы между словами описания), дальше — новая ячейка
// (колонка). Выравнивание ячеек по колонкам — domain/structure.ts: колонок здесь ещё не знаем.
import sharp from "sharp";
import { extractImages, getDocumentProxy } from "unpdf";
import { SandboxRejection } from "../../../../platform/sandbox/isolated.ts";
import type { RawCell, RawDocument, RawLine, RawImage } from "../../domain/types.ts";
import { MAX_LINES } from "./read-csv.ts";

/** Страниц текста — до 300 (год выписки по карте); сканов (страниц-картинок) — до 6: больше модель не прочтёт. */
const MAX_TEXT_PAGES = 300;
const MAX_SCAN_PAGES = 6;
/** Меньше — это значки и логотипы, а не страница документа. */
const MIN_IMAGE_PIXELS = 90_000;
/** Меньше стольких знаков на весь документ — текстового слоя нет, это скан. */
const MIN_TEXT_CHARS = 30;

interface Word {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function linesOf(words: readonly Word[], page: number): RawLine[] {
  const sorted = words.toSorted((a, b) => b.y - a.y || a.x - b.x);
  const lines: RawLine[] = [];
  let current: Word[] = [];
  let lineY = Number.NaN;
  const flush = () => {
    if (current.length === 0) return;
    const ordered = current.toSorted((a, b) => a.x - b.x);
    const cells: RawCell[] = [];
    let cell: { text: string; x0: number; x1: number; height: number } | undefined;
    for (const word of ordered) {
      const gap = cell === undefined ? Number.POSITIVE_INFINITY : word.x - cell.x1;
      if (cell !== undefined && gap <= Math.max(cell.height, 6) * 0.5) {
        cell.text += `${gap > Math.max(cell.height, 6) * 0.08 ? " " : ""}${word.text}`;
        cell.x1 = word.x + word.width;
      } else {
        if (cell !== undefined) cells.push({ text: cell.text, x0: cell.x0, x1: cell.x1 });
        cell = { text: word.text, x0: word.x, x1: word.x + word.width, height: word.height };
      }
    }
    if (cell !== undefined) cells.push({ text: cell.text, x0: cell.x0, x1: cell.x1 });
    lines.push({ cells, page, y: lineY });
    current = [];
  };
  for (const word of sorted) {
    if (Number.isNaN(lineY) || Math.abs(word.y - lineY) > Math.max(2, word.height * 0.5)) {
      flush();
      lineY = word.y;
    }
    current.push(word);
  }
  flush();
  return lines;
}

export async function readPdf(bytes: Uint8Array): Promise<RawDocument> {
  // pdf.js забирает буфер себе: читаем копию, исходные байты вызывающий ещё может понадобиться (скан без текста).
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new SandboxRejection("unreadable");
  }
  const lines: RawLine[] = [];
  let chars = 0;
  for (let number = 1; number <= Math.min(pdf.numPages, MAX_TEXT_PAGES); number++) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    const words: Word[] = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      chars += item.str.trim().length;
      words.push({
        text: item.str.trim(),
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
        width: item.width,
        height: item.height,
      });
    }
    lines.push(...linesOf(words, number));
    if (lines.length > MAX_LINES) throw new SandboxRejection("too-big");
  }
  if (chars >= MIN_TEXT_CHARS) return { kind: "table", table: { kind: "pdf", lines } };
  return { kind: "images", images: await pageImages(pdf) };
}

/** Скан без текстового слоя: самая большая картинка каждой из первых страниц — PNG (unpdf + sharp, без canvas). */
async function pageImages(pdf: Awaited<ReturnType<typeof getDocumentProxy>>): Promise<RawImage[]> {
  const images: RawImage[] = [];
  for (let number = 1; number <= Math.min(pdf.numPages, MAX_SCAN_PAGES); number++) {
    const found = await extractImages(pdf, number);
    const biggest = found
      .filter((image) => image.width * image.height >= MIN_IMAGE_PIXELS)
      .toSorted((a, b) => b.width * b.height - a.width * a.height)[0];
    if (biggest === undefined) continue;
    const png = await sharp(Buffer.from(biggest.data), {
      raw: { width: biggest.width, height: biggest.height, channels: biggest.channels },
    })
      .png()
      .toBuffer();
    images.push({ bytes: new Uint8Array(png), mime: "image/png" });
  }
  if (images.length === 0) throw new SandboxRejection("unreadable");
  return images;
}
