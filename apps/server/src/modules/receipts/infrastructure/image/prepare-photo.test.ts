// SEC-03, RCPT-01, RCPT-04, PRIV-04: подготовка фото чека в изолированном потоке на настоящих декодерах — HEIC iPhone
// (sharp его не читает), поворот, QR с УИ локально, копия для модели без метаданных, «бомба» картинки.
import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { uidFromQr } from "../../domain/qr.ts";
import { caseIds, loadCase } from "../../__fixtures__/datasets.ts";
import { PhotoReadError } from "../../application/ports.ts";
import { makePhotoPreparer } from "./prepare-photo.ts";

const preparer = makePhotoPreparer(async () => ({ timeoutMs: 60_000, memoryMb: 1_024 }));
const prepare = (item: ReturnType<typeof loadCase>, maxSide = 2_000) =>
  preparer.prepare({ type: item.type, bytes: item.bytes, maxSide });

describe("RCPT-04: QR с УИ читается локально из каждого фото набора", () => {
  it.each(caseIds())(
    "%s",
    async (id) => {
      const item = loadCase(id);
      const prepared = await prepare(item);
      const uid = prepared.codes
        .map((code) => uidFromQr(code))
        .find((value) => value !== undefined);
      // Читается ли QR, решает эталон: у чека без QR и с бликом на нём УИ из фото не берётся.
      expect(uid).toBe(item.expected.qr.readable ? item.expected.uid : undefined);
      expect(prepared.mime).toBe("image/jpeg");
    },
    60_000,
  );
});

describe("RCPT-01: HEIC снимка iPhone", () => {
  it("HEIC читается и поворачивается по irot: из «лежащего» кадра получается портретный чек", async () => {
    const item = loadCase("zelenaya-iphone-heic");
    expect(item.type).toBe("heic");
    const prepared = await prepare(item);
    const meta = await sharp(prepared.image).metadata();
    expect(meta.format).toBe("jpeg");
    expect((meta.height ?? 0) > (meta.width ?? 0)).toBe(true);
  }, 60_000);
});

describe("PRIV-04: копия для модели", () => {
  it("длинная сторона не больше предела, а метаданные (EXIF, GPS) не переносятся", async () => {
    const item = loadCase("sosnovy-clean-card");
    const withExif = await sharp(item.bytes)
      .withExif({ IFD0: { Copyright: "synthetic" }, IFD3: { GPSLatitudeRef: "N" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const prepared = await preparer.prepare({ type: "jpg", bytes: withExif, maxSide: 900 });
    const meta = await sharp(prepared.image).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(900);
    expect(meta.exif).toBeUndefined();
  }, 60_000);

  it("EXIF-ориентация применяется: чек, снятый «лёжа», читается с УИ", async () => {
    const item = loadCase("sosnovy-clean-card");
    // Кадр хранится повёрнутым на 90°, а тег Orientation=6 велит повернуть его обратно.
    const stored = await sharp(item.bytes)
      .rotate(90)
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const prepared = await preparer.prepare({ type: "jpg", bytes: stored, maxSide: 2_000 });
    const meta = await sharp(prepared.image).metadata();
    expect((meta.height ?? 0) > (meta.width ?? 0)).toBe(true);
    expect(prepared.codes.map((code) => uidFromQr(code))).toContain(item.expected.uid);
  }, 60_000);
});

/** Минимальный PNG, который объявляет огромные размеры и почти ничего не весит: «бомба разжатия». */
function pngBomb(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.alloc(64))),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

describe("SEC-03: недоверенное фото", () => {
  it("«бомба» — PNG на 150 Мп в нескольких байтах — отклоняется до разжатия как нечитаемое фото", async () => {
    const bomb = pngBomb(15_000, 10_000);
    expect(bomb.byteLength).toBeLessThan(200);
    const failure = await preparer
      .prepare({ type: "png", bytes: bomb, maxSide: 2_000 })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PhotoReadError);
    expect((failure as PhotoReadError).reason).toBe("unreadable");
  }, 30_000);

  it("битый файл — нечитаемое фото, а не падение процесса", async () => {
    const failure = await preparer
      .prepare({ type: "jpg", bytes: new Uint8Array([1, 2, 3, 4]), maxSide: 2_000 })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PhotoReadError);
    expect((failure as PhotoReadError).reason).toBe("unreadable");
  }, 30_000);

  it("поток, не уложившийся в срок, прерывается: сбой «timeout», процесс жив", async () => {
    const slow = makePhotoPreparer(async () => ({ timeoutMs: 1, memoryMb: 1_024 }));
    const failure = await slow
      .prepare({ type: "jpg", bytes: loadCase("sosnovy-clean-card").bytes, maxSide: 2_000 })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PhotoReadError);
    expect((failure as PhotoReadError).reason).toBe("timeout");
  }, 30_000);
});
