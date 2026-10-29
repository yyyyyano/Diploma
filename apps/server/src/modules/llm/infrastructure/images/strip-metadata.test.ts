// PRIV-04: фото чека уходит в облако без EXIF и геометок; поворот по EXIF применён; формат сохранён.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageSanitizeError, sanitizeFilePart, stripImageMetadata } from "./strip-metadata.ts";

/** JPEG 4×2 с EXIF: производитель, GPS-координаты и ориентация «повернуть на 90°». */
async function photo(): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width: 4, height: 2, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: "SecretPhone" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "53/1 54/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "27/1 33/1 0/1",
      },
    })
    .toBuffer();
  return new Uint8Array(buffer);
}

describe("PRIV-04: изображение без метаданных", () => {
  it("исходное фото несёт EXIF с геометкой — тест проверяет то, что нужно", async () => {
    const meta = await sharp(await photo()).metadata();
    expect(meta.exif).toBeDefined();
    expect(Buffer.from(meta.exif ?? []).includes(Buffer.from("SecretPhone"))).toBe(true);
  });

  it("после очистки EXIF, GPS и производителя нет; ориентация применена (4×2 с поворотом → 2×4)", async () => {
    const clean = await stripImageMetadata(await photo());
    const meta = await sharp(clean).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(Buffer.from(clean).includes(Buffer.from("SecretPhone"))).toBe(false);
    expect(Buffer.from(clean).includes(Buffer.from("GPS"))).toBe(false);
    expect([meta.width, meta.height]).toEqual([2, 4]);
    expect(meta.format).toBe("jpeg");
  });

  it("PNG и WebP остаются своим форматом", async () => {
    for (const format of ["png", "webp"] as const) {
      const source = await sharp({
        create: { width: 3, height: 3, channels: 3, background: "#fff" },
      })
        [format]()
        .toBuffer();
      const meta = await sharp(await stripImageMetadata(new Uint8Array(source))).metadata();
      expect(meta.format).toBe(format);
    }
  });

  it("не изображение — ImageSanitizeError: в облако такое не уходит", async () => {
    await expect(
      stripImageMetadata(new TextEncoder().encode("не картинка")),
    ).rejects.toBeInstanceOf(ImageSanitizeError);
  });
});

describe("файловая часть промпта", () => {
  it("изображение (байты или base64) очищается, имя и тип сохраняются", async () => {
    const source = await photo();
    const part = await sanitizeFilePart({
      type: "file",
      mediaType: "image/jpeg",
      filename: "чек.jpg",
      data: { type: "data", data: Buffer.from(source).toString("base64") },
    });
    expect(part).toMatchObject({ mediaType: "image/jpeg", filename: "чек.jpg" });
    const data = part.data.type === "data" ? part.data.data : undefined;
    expect(data instanceof Uint8Array).toBe(true);
    expect((await sharp(data as Uint8Array).metadata()).exif).toBeUndefined();
  });

  it("не изображение и ссылка проходят как есть", async () => {
    const text = {
      type: "file" as const,
      mediaType: "text/plain",
      data: { type: "text" as const, text: "а" },
    };
    expect(await sanitizeFilePart(text)).toBe(text);
    const link = {
      type: "file" as const,
      mediaType: "image/png",
      data: { type: "url" as const, url: new URL("https://example.test/a.png") },
    };
    expect(await sanitizeFilePart(link)).toBe(link);
  });
});
