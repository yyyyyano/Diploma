// Фото чека (T-027): лист рисуется контурами букв моноширинного DejaVu (fontkit) в SVG, SVG растеризует sharp, QR — из
// писателя zxing-wasm (его же читает приложение). Дальше «съёмка»: наклон, размытие, мятая бумага, шум, тень стола.
// Всё детерминировано: случайность — только из зерна (rng.ts), поэтому байты повторяются при каждом запуске.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { openSync } from "fontkit";
import sharp, { type OverlayOptions } from "sharp";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import type { PrintedReceipt, ReceiptSpec } from "./receipt-model.ts";
import { rng } from "./rng.ts";

const require = createRequire(import.meta.url);
prepareZXingModule({
  overrides: {
    wasmBinary: readFileSync(require.resolve("zxing-wasm/writer/zxing_writer.wasm"))
      .buffer as ArrayBuffer,
  },
});

const FONT_FILE = require.resolve("dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf");
const BOLD_FILE = require.resolve("dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf");
const font = openSync(FONT_FILE);
const bold = openSync(BOLD_FILE);
if (!("layout" in font) || !("layout" in bold)) throw new Error("Ожидался одиночный шрифт.");

const SIZE = 21;
const LINE = 29;
const PAPER_WIDTH = 620;
const MARGIN = 34;
const QR_SIZE = 210;

type Align = "left" | "right" | "center";

function textPath(text: string, y: number, align: Align, strong = false): string {
  const face = strong ? bold : font;
  if (!("layout" in face)) return "";
  const run = face.layout(text);
  const scale = SIZE / face.unitsPerEm;
  const advance = run.positions.reduce((acc, p) => acc + p.xAdvance, 0) * scale;
  let pen =
    align === "left"
      ? MARGIN
      : align === "right"
        ? PAPER_WIDTH - MARGIN - advance
        : (PAPER_WIDTH - advance) / 2;
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

interface Row {
  readonly left?: string;
  readonly right?: string;
  readonly center?: string;
  readonly strong?: boolean;
}

function rowsOf(spec: ReceiptSpec, printed: PrintedReceipt, dateLabel?: string): Row[] {
  const [year = "", month = "", day = ""] = spec.date.split("-");
  const rows: Row[] = [
    { center: spec.shop.title, strong: true },
    { center: `УНП ${spec.shop.unp}` },
    { center: spec.shop.address },
    { center: "КАССОВЫЙ ЧЕК" },
    {
      left: `№ ${String(spec.number).padStart(4, "0")}`,
      right: `${dateLabel ?? `${day}.${month}.${year}`} ${spec.time}`,
    },
    { center: "-".repeat(40) },
  ];
  for (const line of printed.lines) {
    rows.push({ left: line.name });
    rows.push({
      left: `  ${line.quantity} x ${line.unitPrice}`,
      right: line.lineTotal,
    });
    if (line.discount !== null) rows.push({ left: "  Скидка", right: line.discount });
  }
  rows.push({ center: "-".repeat(40) });
  if (printed.receiptDiscount !== null) {
    rows.push({ left: "Скидка на чек", right: printed.receiptDiscount });
  }
  rows.push({ left: "ИТОГО", right: printed.total, strong: true });
  rows.push({
    left:
      spec.payment.method === "cash"
        ? "Оплата: наличные"
        : `Оплата: карта ****${spec.payment.last4}`,
  });
  rows.push({ left: `УИ ${spec.uid}` });
  return rows;
}

export interface PaperOptions {
  /** Рисовать QR с УИ под итогом. */
  readonly qr: boolean;
  /** Полоса поверх QR: код на фото не читается (размытый блик). */
  readonly coverQr?: boolean;
  /** Служебная строка внизу — например, приказ, напечатанный на чеке (RCPT-14). */
  readonly footer?: string;
  /** Подпись вместо даты («ДЕМО»): фото демо-чека не должно спорить с днём, который показывает карточка (DEMO-02). */
  readonly dateLabel?: string;
}

/** Содержимое QR: ссылка с УИ — формат придуман (реального образца нет), приложение ищет в нём 24 символа. */
export const qrPayload = (uid: string, date: string) =>
  `https://check.example.test/c?uid=${uid}&d=${date}`;

/** Лист чека: PNG с белой бумагой и текстом. */
export async function renderPaper(
  spec: ReceiptSpec,
  printed: PrintedReceipt,
  options: PaperOptions,
): Promise<{ png: Uint8Array; width: number; height: number }> {
  const rows = rowsOf(spec, printed, options.dateLabel);
  const parts: string[] = [];
  let y = 54;
  for (const row of rows) {
    if (row.center !== undefined) parts.push(textPath(row.center, y, "center", row.strong));
    if (row.left !== undefined) parts.push(textPath(row.left, y, "left", row.strong));
    if (row.right !== undefined) parts.push(textPath(row.right, y, "right", row.strong));
    y += LINE;
  }
  if (options.footer !== undefined) {
    y += 6;
    parts.push(textPath(options.footer, y, "center"));
    y += LINE;
  }
  const qrTop = y + 18;
  const height = options.qr ? qrTop + QR_SIZE + 60 : y + 50;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAPER_WIDTH}" height="${height}" viewBox="0 0 ${PAPER_WIDTH} ${height}"><rect width="100%" height="100%" fill="#fdfdfb"/><g fill="#222">${parts.join("")}</g></svg>`;
  let paper = sharp(Buffer.from(svg));
  if (options.qr) {
    const written = await writeBarcode(qrPayload(spec.uid, spec.date), {
      format: "QRCode",
      ecLevel: "M",
      scale: 1,
    });
    if (written.error !== "" && written.error !== undefined) {
      throw new Error(`QR не нарисован: ${written.error}`);
    }
    // Растр без сглаживания: модули остаются чёткими квадратами.
    const modules = await sharp(Buffer.from(written.svg), { density: 300 })
      .flatten({ background: "#ffffff" })
      .resize(QR_SIZE, QR_SIZE, { kernel: "nearest" })
      .png()
      .toBuffer();
    const layers: OverlayOptions[] = [
      { input: modules, left: Math.round((PAPER_WIDTH - QR_SIZE) / 2), top: qrTop },
    ];
    if (options.coverQr === true) {
      // Блик поверх кода: широкая светлая полоса со смазанным краем.
      const glare = await sharp({
        create: {
          width: QR_SIZE,
          height: 90,
          channels: 4,
          background: { r: 250, g: 250, b: 247, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      layers.push({
        input: glare,
        left: Math.round((PAPER_WIDTH - QR_SIZE) / 2),
        top: qrTop + 60,
      });
    }
    paper = sharp(await paper.png().toBuffer()).composite(layers);
  }
  return { png: new Uint8Array(await paper.png().toBuffer()), width: PAPER_WIDTH, height };
}

export type Quality = "clean" | "tilted-blur" | "crumpled" | "noisy-dark";

const DESK = { width: 1200, height: 1700 };

/** Одно и то же зерно — одна и та же «съёмка». */
export async function photograph(
  paper: { png: Uint8Array; width: number; height: number },
  quality: Quality,
  seed: number,
): Promise<Uint8Array> {
  const random = rng(seed);
  const angle =
    quality === "tilted-blur"
      ? 4.5
      : quality === "crumpled"
        ? -3
        : quality === "noisy-dark"
          ? 1.5
          : 0;
  // Лист крупнее: на столе 1200 px, а на самом листе QR остаётся в 7–8 пикселей на модуль.
  const scale = Math.min((DESK.width - 160) / paper.width, (DESK.height - 160) / paper.height);
  let sheet = sharp(paper.png).resize(Math.round(paper.width * scale));
  if (quality === "crumpled") {
    // Складки: пересекающиеся светлые и тёмные полосы разной толщины поверх листа.
    const widthPx = Math.round(paper.width * scale);
    const heightPx = Math.round(paper.height * scale);
    const strips: string[] = [];
    for (let i = 0; i < 9; i++) {
      const y0 = Math.round(random() * heightPx);
      const y1 = Math.round(random() * heightPx);
      const light = i % 2 === 0;
      strips.push(
        `<line x1="0" y1="${y0}" x2="${widthPx}" y2="${y1}" stroke="${light ? "#ffffff" : "#000000"}" stroke-opacity="${light ? 0.35 : 0.16}" stroke-width="${6 + Math.round(random() * 10)}"/>`,
      );
    }
    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}">${strips.join("")}</svg>`;
    sheet = sharp(await sheet.png().toBuffer()).composite([
      { input: Buffer.from(overlay), blend: "over" },
    ]);
  }
  const rotated = await sheet
    .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const info = await sharp(rotated).metadata();
  const left = Math.round((DESK.width - (info.width ?? 0)) / 2);
  const top = Math.round((DESK.height - (info.height ?? 0)) / 2);
  const desk = quality === "noisy-dark" ? "#3a3530" : "#6b5f52";
  const base = sharp({
    create: { width: DESK.width, height: DESK.height, channels: 3, background: desk },
  });
  const layers: OverlayOptions[] = [{ input: rotated, left, top }];
  if (quality === "noisy-dark") {
    // Шум: серые пиксели из зерна поверх всего кадра.
    const noise = Buffer.alloc(DESK.width * DESK.height * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.round(128 + (random() - 0.5) * 70);
    layers.push({
      input: noise,
      raw: { width: DESK.width, height: DESK.height, channels: 3 },
      blend: "soft-light",
    });
  }
  let frame = sharp(await base.composite(layers).png().toBuffer());
  if (quality === "tilted-blur") frame = frame.blur(0.9);
  if (quality === "noisy-dark") frame = frame.modulate({ brightness: 0.8 }).blur(0.5);
  return new Uint8Array(await frame.jpeg({ quality: 82, mozjpeg: false }).toBuffer());
}
