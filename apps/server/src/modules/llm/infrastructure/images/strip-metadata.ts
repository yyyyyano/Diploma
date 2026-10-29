// Изображение перед облаком (PRIV-04): фото чека и скан выписки перекодируются без метаданных — EXIF (в том числе
// GPS-координаты места съёмки, модель телефона, время), XMP, IPTC и встроенные миниатюры не уходят за пределы
// компьютера. Поворот по EXIF применяется до удаления (`rotate()`): картинка остаётся той же стороной вверх. Формат
// сохраняется; JPEG и WebP — с высоким качеством (мелкий текст чека должен остаться читаемым). Формат, который sharp
// не читает (например, HEIC без кодека), в облако не уходит вовсе: ошибка, цепочка идёт к локальной модели.
import type { LanguageModelV4FilePart } from "@ai-sdk/provider";
import sharp from "sharp";

export class ImageSanitizeError extends Error {
  readonly code = "IMAGE_SANITIZE";
  override readonly name = "ImageSanitizeError";
  constructor(cause?: unknown) {
    super("Изображение нельзя очистить от метаданных — в облако оно не уходит.", { cause });
  }
}

const JPEG_QUALITY = 95;
const WEBP_QUALITY = 95;

/** Те же пиксели без метаданных; формат тот же. */
export async function stripImageMetadata(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const image = sharp(bytes, { failOn: "none" }).rotate();
    const { format } = await sharp(bytes, { failOn: "none" }).metadata();
    const encoded =
      format === "jpeg"
        ? image.jpeg({ quality: JPEG_QUALITY })
        : format === "webp"
          ? image.webp({ quality: WEBP_QUALITY })
          : format === "png"
            ? image.png()
            : format === "gif"
              ? image.gif()
              : undefined;
    if (encoded === undefined) throw new Error(`формат ${String(format)}`);
    return new Uint8Array(await encoded.toBuffer());
  } catch (error) {
    throw new ImageSanitizeError(error);
  }
}

const toBytes = (data: Uint8Array | string): Uint8Array =>
  typeof data === "string" ? new Uint8Array(Buffer.from(data, "base64")) : data;

/** Файловая часть промпта: изображение с данными — очищается; иное (текст, ссылка) — как есть. */
export async function sanitizeFilePart(
  part: LanguageModelV4FilePart,
): Promise<LanguageModelV4FilePart> {
  if (!part.mediaType.startsWith("image") || part.data.type !== "data") return part;
  const clean = await stripImageMetadata(toBytes(part.data.data));
  return { ...part, data: { type: "data", data: clean } };
}
