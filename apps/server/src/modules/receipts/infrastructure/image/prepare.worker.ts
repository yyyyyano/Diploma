// Рабочий файл изолированной подготовки фото чека (SEC-03, platform/sandbox): выполняется в worker_thread под лимитами
// памяти и времени. Недоверенные декодеры (sharp, heic-decode, zxing-wasm) живут только здесь. Шаги (research 06 §4.4):
// HEIC → пиксели (sharp HEVC не читает) → поворот по EXIF → копия для модели (JPEG без метаданных) → QR несколькими
// попытками с разной предобработкой, остановка на первом успехе.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import decodeHeic from "heic-decode";
import sharp from "sharp";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { SandboxRejection } from "../../../../platform/sandbox/isolated.ts";
import { serveIsolated } from "../../../../platform/sandbox/serve.ts";
import type { PrepareInput, PreparedPhoto } from "../../application/ports.ts";

// .wasm — с диска из node_modules, а не с CDN (по умолчанию zxing-wasm качает его с jsDelivr: «всё локально», NFR-05).
const require = createRequire(import.meta.url);
prepareZXingModule({
  overrides: {
    wasmBinary: readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"))
      .buffer as ArrayBuffer,
  },
});

/** Предел пикселей входа: больше — «бомба разжатия» (картинка в килобайтах, в памяти — гигабайты). */
const MAX_PIXELS = 100_000_000;

/** Попытки чтения QR: сторона, нормализация яркости, резкость. Хватает первой удачной (бюджет ~0,3 с). */
const QR_ATTEMPTS = [
  { side: 2000, normalise: false, sharpen: false },
  { side: 1400, normalise: true, sharpen: false },
  { side: 1000, normalise: true, sharpen: false },
  { side: 1400, normalise: false, sharpen: true },
] as const;

async function toSharp(input: PrepareInput): Promise<sharp.Sharp> {
  if (input.type === "heic") {
    const decoded = await decodeHeic({ buffer: input.bytes });
    if (decoded.width * decoded.height > MAX_PIXELS) throw new SandboxRejection("too-big");
    // libheif применяет поворот и отражение из файла сам: .rotate() после него не нужен.
    return sharp(
      Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
      {
        raw: { width: decoded.width, height: decoded.height, channels: 4 },
      },
    );
  }
  // .rotate() без аргументов применяет EXIF-ориентацию; limitInputPixels отказывает «бомбе» до разжатия.
  return sharp(input.bytes, { limitInputPixels: MAX_PIXELS }).rotate();
}

serveIsolated(async (input: PrepareInput): Promise<PreparedPhoto> => {
  let base: sharp.Sharp;
  try {
    base = await toSharp(input);
    // Читаем «заголовок» заранее: битый файл падает тут, а не посреди кодирования.
    await base.clone().metadata();
  } catch (error) {
    if (error instanceof SandboxRejection) throw error;
    throw new SandboxRejection("unreadable");
  }
  try {
    // Метаданные (EXIF, GPS) не копируются: sharp по умолчанию их отбрасывает (PRIV-04).
    const image = await base
      .clone()
      .resize({
        width: input.maxSide,
        height: input.maxSide,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();
    const codes: string[] = [];
    for (const attempt of QR_ATTEMPTS) {
      let frame = base
        .clone()
        // Без withoutEnlargement: у снимка экрана QR мелкий, и в увеличенном виде он читается, а в исходном — нет.
        .resize({ width: attempt.side, height: attempt.side, fit: "inside" })
        .grayscale();
      if (attempt.normalise) frame = frame.normalise();
      if (attempt.sharpen) frame = frame.sharpen();
      const { data, info } = await frame.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const found = await readBarcodes(
        {
          data: new Uint8ClampedArray(data),
          width: info.width,
          height: info.height,
          colorSpace: "srgb",
        },
        {
          formats: ["QRCode"],
          tryHarder: true,
          tryRotate: true,
          tryInvert: true,
          tryDownscale: true,
        },
      );
      // Один код приходит несколько раз (повороты, инверсия, уменьшение): оставляем разные тексты.
      for (const { text } of found) if (text !== "" && !codes.includes(text)) codes.push(text);
      if (codes.length > 0) break;
    }
    return { image: new Uint8Array(image), mime: "image/jpeg", codes };
  } catch {
    throw new SandboxRejection("unreadable");
  }
});
