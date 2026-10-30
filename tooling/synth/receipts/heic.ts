// HEIC для набора чеков (T-027): снимки iPhone — самое неудобное входное. sharp (его libvips без HEVC) такой файл не
// читает, поэтому приложение берёт heic-decode, а проверить его нечем без настоящего HEIC. Свободного образца нет
// (скачивать чужое мы не стали), и кодировщика HEIC в npm нет, поэтому файл собирается здесь: ffmpeg (libx265) кодирует
// один HEVC-кадр, а контейнер HEIF (ftyp, meta: hdlr, pitm, iloc, iinf, iprp с ispe, hvcC и irot, затем mdat) пишется руками
// по ISO/IEC 23008-12. Кадр хранится «лёжа», как у iPhone, а поворот задаёт irot — декодер обязан его применить.
// Нужен ffmpeg с libx265 (есть в Ubuntu); результат повторяем бит в бит при одном потоке кодирования.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const u16 = (n: number) => Buffer.from([(n >>> 8) & 255, n & 255]);
const u32 = (n: number) =>
  Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const ascii = (text: string) => Buffer.from(text, "ascii");

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  return Buffer.concat([u32(8 + body.length), ascii(type), body]);
}
const fullBox = (type: string, version: number, ...payload: Buffer[]) =>
  box(type, Buffer.from([version, 0, 0, 0]), ...payload);

/** Все блоки одного уровня буфера: [тип, начало полезной нагрузки, конец]. */
function* boxes(buffer: Buffer, from = 0, to = buffer.length): Generator<[string, number, number]> {
  let at = from;
  while (at + 8 <= to) {
    const size = buffer.readUInt32BE(at);
    if (size < 8 || at + size > to) return;
    yield [buffer.toString("ascii", at + 4, at + 8), at + 8, at + size];
    at += size;
  }
}

/** hvcC первого видеопотока mp4: moov → trak → mdia → minf → stbl → stsd → hvc1 → hvcC. */
function findHvcC(mp4: Buffer): Buffer {
  const path = ["moov", "trak", "mdia", "minf", "stbl"] as const;
  let range: [number, number] = [0, mp4.length];
  for (const name of path) {
    const next = [...boxes(mp4, ...range)].find(([type]) => type === name);
    if (next === undefined) throw new Error(`в mp4 нет блока ${name}`);
    range = [next[1], next[2]];
  }
  const stsd = [...boxes(mp4, ...range)].find(([type]) => type === "stsd");
  if (stsd === undefined) throw new Error("в mp4 нет stsd");
  // stsd: 4 байта версии/флагов + 4 байта числа записей, дальше — запись hvc1 с 78 байтами видеозаголовка.
  const entry = [...boxes(mp4, stsd[1] + 8, stsd[2])].find(([type]) => type === "hvc1");
  if (entry === undefined) throw new Error("в mp4 нет записи hvc1 (кодек не HEVC)");
  const config = [...boxes(mp4, entry[1] + 78, entry[2])].find(([type]) => type === "hvcC");
  if (config === undefined) throw new Error("в записи hvc1 нет hvcC");
  return mp4.subarray(config[1], config[2]);
}

/** Единственный отсчёт кадра: полезная нагрузка mdat (длина-NAL, как требует HEIF). */
function findSample(mp4: Buffer): Buffer {
  const mdat = [...boxes(mp4)].find(([type]) => type === "mdat");
  if (mdat === undefined) throw new Error("в mp4 нет mdat");
  return mp4.subarray(mdat[1], mdat[2]);
}

/**
 * Картинка → HEIC (один HEVC-кадр). `quarterTurns` — на сколько четвертей по часовой стрелке кадр хранится повёрнутым:
 * в файле он «лежит», а irot велит повернуть его обратно при показе.
 */
export async function encodeHeic(
  image: Uint8Array,
  quarterTurns: 0 | 1 | 2 | 3,
): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "kosht-heic-"));
  try {
    const stored = await sharp(image)
      .rotate(quarterTurns * 90)
      .png()
      .toBuffer();
    const meta = await sharp(stored).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    // yuv420p требует чётных сторон: лишний пиксель обрезается (после поворота обратно это край стола).
    const even = { width: width - (width % 2), height: height - (height % 2) };
    writeFileSync(join(dir, "in.png"), stored);
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        join(dir, "in.png"),
        "-vf",
        `crop=${even.width}:${even.height}:0:0`,
        "-frames:v",
        "1",
        "-c:v",
        "libx265",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-tag:v",
        "hvc1",
        "-threads",
        "1",
        "-x265-params",
        "pools=1:frame-threads=1:log-level=none:no-info=1",
        "-f",
        "mp4",
        join(dir, "out.mp4"),
      ],
      { stdio: "pipe" },
    );
    const mp4 = readFileSync(join(dir, "out.mp4"));
    const hvcC = box("hvcC", findHvcC(mp4));
    const sample = findSample(mp4);
    const ispe = fullBox("ispe", 0, u32(even.width), u32(even.height));
    // irot: поворот против часовой на angle × 90°; кадр хранится повёрнутым по часовой на quarterTurns четвертей.
    const irot = box("irot", Buffer.from([quarterTurns % 4]));
    const ipco = box("ipco", ispe, hvcC, irot);
    const ipma = fullBox(
      "ipma",
      0,
      u32(1),
      u16(1),
      // три ассоциации: ispe (1), hvcC (2, обязательна), irot (3, обязательна)
      Buffer.from([3, 1, 0x80 | 2, 0x80 | 3]),
    );
    const iprp = box("iprp", ipco, ipma);
    const hdlr = fullBox("hdlr", 0, u32(0), ascii("pict"), Buffer.alloc(12), Buffer.from([0]));
    const pitm = fullBox("pitm", 0, u16(1));
    const infe = fullBox("infe", 2, u16(1), u16(0), ascii("hvc1"), Buffer.from([0]));
    const iinf = fullBox("iinf", 0, u16(1), infe);
    const ftyp = box("ftyp", ascii("heic"), u32(0), ascii("mif1"), ascii("heic"));
    const ilocFor = (offset: number) =>
      fullBox(
        "iloc",
        0,
        Buffer.from([0x44, 0x00]),
        u16(1),
        u16(1),
        u16(0),
        u16(1),
        u32(offset),
        u32(sample.length),
      );
    const metaWithoutOffset = fullBox("meta", 0, hdlr, pitm, ilocFor(0), iinf, iprp);
    const offset = ftyp.length + metaWithoutOffset.length + 8;
    const metaBox = fullBox("meta", 0, hdlr, pitm, ilocFor(offset), iinf, iprp);
    return new Uint8Array(Buffer.concat([ftyp, metaBox, box("mdat", sample)]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
