// Защита от ZIP-бомб до SheetJS (SEC-03): XLSX — это ZIP, а крошечный архив разворачивается в гигабайты. Центральный
// каталог читается руками (без распаковки): число записей, суммарный несжатый размер и коэффициент сжатия должны
// быть разумны для таблицы. Zip64 и записи с размерами «0xFFFFFFFF» — отказ: настоящая выписка в 25 МБ до них не
// дорастает. Чистая функция над байтами: проверка не требует ни файлов, ни библиотек.
import { SandboxRejection } from "../../../../platform/sandbox/isolated.ts";

export interface ZipLimits {
  readonly maxEntries: number;
  /** Суммарный несжатый размер, байт. */
  readonly maxUncompressed: number;
  /** Несжатый ÷ сжатый, по всему архиву. */
  readonly maxRatio: number;
}

/** Умолчания для XLSX: 2000 файлов, 200 МБ после распаковки, сжатие не больше чем в 150 раз. */
export const XLSX_ZIP_LIMITS: ZipLimits = {
  maxEntries: 2_000,
  maxUncompressed: 200 * 1024 * 1024,
  maxRatio: 150,
};

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const ZIP64_MARK = 0xffffffff;

/** Проверить архив; небезопасный — `SandboxRejection("zip-bomb")`, не архив — `SandboxRejection("unreadable")`. */
export function assertSafeZip(bytes: Uint8Array, limits: ZipLimits = XLSX_ZIP_LIMITS): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Запись конца каталога — в последних 64 КБ (комментарий архива до 65535 байт).
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SandboxRejection("unreadable");
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  let offset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || directorySize === ZIP64_MARK || offset === ZIP64_MARK) {
    throw new SandboxRejection("zip-bomb");
  }
  if (entries > limits.maxEntries) throw new SandboxRejection("zip-bomb");
  let uncompressed = 0;
  let compressed = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== CENTRAL) {
      throw new SandboxRejection("unreadable");
    }
    const packed = view.getUint32(offset + 20, true);
    const unpacked = view.getUint32(offset + 24, true);
    if (packed === ZIP64_MARK || unpacked === ZIP64_MARK) throw new SandboxRejection("zip-bomb");
    compressed += packed;
    uncompressed += unpacked;
    if (uncompressed > limits.maxUncompressed) throw new SandboxRejection("zip-bomb");
    const name = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true);
    const comment = view.getUint16(offset + 32, true);
    offset += 46 + name + extra + comment;
  }
  // Коэффициент — по всему архиву; крошечные архивы (< 64 КБ после распаковки) не считаются: делить не на что.
  if (uncompressed > 64 * 1024 && uncompressed / Math.max(1, compressed) > limits.maxRatio) {
    throw new SandboxRejection("zip-bomb");
  }
}
