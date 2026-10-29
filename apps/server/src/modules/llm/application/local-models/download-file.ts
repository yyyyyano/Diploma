// Загрузка одного файла модели (NFR-25): HTTP Range с докачкой, проверка sha256, `.part` → переименование, проверка
// свободного места. Файл появляется под своим именем только целиком и с верной суммой: оборванная загрузка оставляет
// `<файл>.part` и продолжается с места обрыва, а не с нуля. Ошибки — коды без текста (OBS-04): `NO_SPACE`, `HTTP_<статус>`,
// `NETWORK`, `SHA256_MISMATCH`, `SIZE_MISMATCH`; `retryable` — стоит ли повторять (сеть и 5xx — да, сумма и место — нет).
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, statfs } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface DownloadSpec {
  readonly url: string;
  /** Итоговый путь файла. */
  readonly dest: string;
  readonly sha256: string;
  readonly size: number;
}

export class ModelDownloadError extends Error {
  override readonly name = "ModelDownloadError";
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}

export interface DownloadDeps {
  readonly fetch?: typeof fetch;
  /** Сколько байт файла уже на диске, из скольких — по ходу загрузки и после проверки. */
  readonly onProgress?: (done: number, total: number) => void;
  readonly signal?: AbortSignal;
  /** Свободно байт в папке; по умолчанию — statfs. В тестах подменяется. */
  readonly freeBytes?: (dir: string) => Promise<number>;
}

/** Запас места сверх размера файла: временные файлы и журнал. */
export const SPACE_MARGIN = 64 * 1024 * 1024;

const fileSize = async (path: string): Promise<number | undefined> =>
  stat(path).then(
    (info) => info.size,
    () => undefined,
  );

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function defaultFreeBytes(dir: string): Promise<number> {
  const info = await statfs(dir);
  return info.bavail * info.bsize;
}

/** Скачать файл целиком с докачкой; готовый файл нужного размера пропускается. */
export async function downloadFile(spec: DownloadSpec, deps: DownloadDeps = {}): Promise<void> {
  const send = deps.fetch ?? fetch;
  const part = `${spec.dest}.part`;
  await mkdir(dirname(spec.dest), { recursive: true });
  if ((await fileSize(spec.dest)) === spec.size) {
    deps.onProgress?.(spec.size, spec.size);
    return;
  }
  let offset = (await fileSize(part)) ?? 0;
  if (offset > spec.size) {
    await rm(part, { force: true });
    offset = 0;
  }
  const free = await (deps.freeBytes ?? defaultFreeBytes)(dirname(spec.dest));
  if (free < spec.size - offset + SPACE_MARGIN) throw new ModelDownloadError("NO_SPACE", false);

  if (offset < spec.size) await fetchInto(spec, part, offset, send, deps);

  deps.onProgress?.(spec.size, spec.size);
  if ((await fileSize(part)) !== spec.size) {
    await rm(part, { force: true });
    throw new ModelDownloadError("SIZE_MISMATCH", true);
  }
  if ((await sha256Of(part)) !== spec.sha256) {
    // Испорченный файл не докачивают: следующая попытка — с нуля.
    await rm(part, { force: true });
    throw new ModelDownloadError("SHA256_MISMATCH", true);
  }
  await rename(part, spec.dest);
}

async function fetchInto(
  spec: DownloadSpec,
  part: string,
  offset: number,
  send: typeof fetch,
  deps: DownloadDeps,
): Promise<void> {
  let response: Response;
  try {
    response = await send(spec.url, {
      headers: offset > 0 ? { range: `bytes=${String(offset)}-` } : {},
      ...(deps.signal === undefined ? {} : { signal: deps.signal }),
    });
  } catch (error) {
    if (deps.signal?.aborted === true) throw error;
    throw new ModelDownloadError("NETWORK", true);
  }
  if (response.status === 416) {
    // Сервер не принял диапазон (файл на сервере другой длины): начинаем заново.
    await rm(part, { force: true });
    if (offset > 0) return fetchInto(spec, part, 0, send, deps);
  }
  if (!response.ok || response.body === null) {
    const retryable = response.status >= 500 || response.status === 429;
    throw new ModelDownloadError(`HTTP_${String(response.status)}`, retryable);
  }
  // Сервер проигнорировал Range и отдал файл целиком (200) — старая часть не нужна.
  const resumed = response.status === 206 && offset > 0;
  if (
    response.status === 206 &&
    !(response.headers.get("content-range") ?? "").startsWith(`bytes ${String(offset)}-`)
  ) {
    throw new ModelDownloadError("BAD_RANGE", true);
  }
  let done = resumed ? offset : 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      done += chunk.length;
      deps.onProgress?.(Math.min(done, spec.size), spec.size);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      counter,
      createWriteStream(part, { flags: resumed ? "a" : "w" }),
      ...(deps.signal === undefined ? [] : [{ signal: deps.signal }]),
    );
  } catch (error) {
    if (deps.signal?.aborted === true) throw error;
    // Обрыв посреди потока: `.part` остаётся — следующая попытка продолжит с места обрыва.
    throw new ModelDownloadError("NETWORK", true);
  }
}
