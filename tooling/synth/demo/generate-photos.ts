// Фото чеков демо (DEMO-01): лист чека рисуется тем же генератором, что datasets/receipts, но дата заменена подписью «ДЕМО» —
// чеки демо живут от сегодняшнего дня, а напечатанный на картинке день не менялся бы. Картинки мелкие (JPEG ≤ ~30 КБ) и
// ложатся в бандл сервера base64-модулем `domain/photos.ts`: путь от import.meta.url в собранный .mjs не ведёт (паспорт
// apps/server), поэтому файлов рядом нет. `make synth-demo-photos` — пересоздать; результат детерминирован.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { receiptsFor } from "../../../apps/server/src/modules/demo/domain/receipts.ts";
import type { PrintedLine, PrintedReceipt, ReceiptSpec } from "../receipts/receipt-model.ts";
import { renderPaper } from "../receipts/render-receipt.ts";

const TARGET = fileURLToPath(
  new URL("../../../apps/server/src/modules/demo/domain/photos.ts", import.meta.url),
);

/** УИ только у чека с QR; остальным он напечатан как строка. */
const UID_FALLBACK = "DEMO00000000000000000000";

export async function renderDemoPhotos(): Promise<Record<string, string>> {
  const photos: Record<string, string> = {};
  // День не важен: подпись «ДЕМО» заменяет его на листе.
  for (const [index, receipt] of receiptsFor("2026-10-21" as never).entries()) {
    const reading = receipt.reading;
    const lines: PrintedLine[] = reading.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit ?? "шт",
      unitPrice: item.unitPrice,
      discount: item.discount,
      lineTotal: item.lineTotal,
      normalizedName: item.name,
    }));
    const printed: PrintedReceipt = {
      lines,
      receiptDiscount: reading.receiptDiscount,
      total: reading.total,
      arithmetic: {
        ok: true,
        disputedLines: [],
        totalOk: true,
        linesSumMinor: 0,
        expectedTotalMinor: 0,
        printedTotalMinor: 0,
      },
    };
    const spec: ReceiptSpec = {
      shop: { title: reading.store, unp: reading.unp, address: reading.address, products: [] },
      date: "2026-01-01",
      time: reading.time,
      number: 100 + index,
      lines: [],
      payment:
        reading.payment === "cash"
          ? { method: "cash" }
          : { method: "card", last4: reading.cardLast4 ?? "0000" },
      uid: reading.uid ?? UID_FALLBACK,
    };
    const paper = await renderPaper(spec, printed, {
      qr: reading.uid !== null,
      dateLabel: "ДЕМО",
    });
    const jpeg = await sharp(paper.png)
      .resize({ width: 420 })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 55 })
      .toBuffer();
    photos[receipt.key] = jpeg.toString("base64");
  }
  return photos;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const photos = await renderDemoPhotos();
  const body = Object.entries(photos)
    .map(([key, data]) => `  ${key}: "${data}",`)
    .join("\n");
  writeFileSync(
    TARGET,
    `// Файл создан \`make synth-demo-photos\` (tooling/synth/demo/generate-photos.ts) — руками не править.\n// Синтетические фото чеков демо (DEMO-01): вымышленные магазины, подпись «ДЕМО» вместо даты (NFR-18).\nimport type { PhotoKey } from "./receipts.ts";\n\n/** JPEG в base64 по ключу чека. */\nexport const RECEIPT_PHOTOS: Readonly<Record<PhotoKey, string>> = {\n${body}\n};\n`,
  );
  process.stdout.write(
    `Фото чеков демо: ${String(Object.keys(photos).length)} (domain/photos.ts)\n`,
  );
}
