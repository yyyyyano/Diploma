// NFR-25: загрузка файла модели на локальном HTTP-сервере (интернета нет, NFR-11): докачка по Range после обрыва,
// проверка sha256, пропуск готового файла, нехватка места, коды ошибок. Тела — синтетические байты.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { downloadFile, ModelDownloadError, SPACE_MARGIN } from "./download-file.ts";

const BODY = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251));
const SHA = createHash("sha256").update(BODY).digest("hex");

interface Behaviour {
  /** Оборвать соединение после стольких байт (только первый ответ). */
  cutAfter?: number;
  ignoreRange?: boolean;
  status?: number;
  rangeNotSatisfiable?: boolean;
  body?: Buffer;
}

let server: Server;
let base: string;
let behaviour: Behaviour = {};
const requests: { range: string | undefined }[] = [];
let cutDone = false;

function handle(request: IncomingMessage, response: ServerResponse): void {
  const range = request.headers.range;
  requests.push({ range });
  if (behaviour.status !== undefined) {
    response.writeHead(behaviour.status).end();
    return;
  }
  const body = behaviour.body ?? BODY;
  const match = /^bytes=(\d+)-$/.exec(range ?? "");
  if (behaviour.rangeNotSatisfiable === true && match !== null) {
    response.writeHead(416).end();
    return;
  }
  if (match !== null && behaviour.ignoreRange !== true) {
    const start = Number(match[1]);
    response.writeHead(206, {
      "content-range": `bytes ${String(start)}-${String(body.length - 1)}/${String(body.length)}`,
      "content-length": String(body.length - start),
    });
    response.end(body.subarray(start));
    return;
  }
  response.writeHead(200, { "content-length": String(body.length) });
  if (behaviour.cutAfter !== undefined && !cutDone) {
    cutDone = true;
    response.write(body.subarray(0, behaviour.cutAfter));
    setTimeout(() => response.destroy(), 20);
    return;
  }
  response.end(body);
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/model.bin`;
});
afterAll(() => server.close());

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kosht-dl-"));
  behaviour = {};
  requests.length = 0;
  cutDone = false;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const spec = () => ({
  url: base,
  dest: join(dir, "m", "model.bin"),
  sha256: SHA,
  size: BODY.length,
});
/** Недокачанная часть на диске: `<файл>.part` с началом тела. */
async function seedPart(dest: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(`${dest}.part`, bytes);
}

const plenty = async () => Number.MAX_SAFE_INTEGER;

describe("NFR-25: загрузка файла модели", () => {
  it("скачивает целиком, проверяет sha256; временного файла не остаётся; прогресс доходит до размера", async () => {
    const progress: number[] = [];
    await downloadFile(spec(), { freeBytes: plenty, onProgress: (done) => progress.push(done) });
    expect(readFileSync(spec().dest).equals(BODY)).toBe(true);
    expect(existsSync(`${spec().dest}.part`)).toBe(false);
    expect(progress.at(-1)).toBe(BODY.length);
    expect(progress).toEqual(progress.toSorted((a, b) => a - b));
  });

  it("обрыв посреди файла: .part остаётся, повторный вызов докачивает по Range и собирает тот же файл", async () => {
    behaviour = { cutAfter: 120_000 };
    await expect(downloadFile(spec(), { freeBytes: plenty })).rejects.toMatchObject({
      code: "NETWORK",
      retryable: true,
    });
    const partial = readFileSync(`${spec().dest}.part`).length;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(BODY.length);
    expect(existsSync(spec().dest)).toBe(false);

    const progress: number[] = [];
    await downloadFile(spec(), { freeBytes: plenty, onProgress: (done) => progress.push(done) });
    expect(requests.at(-1)?.range).toBe(`bytes=${String(partial)}-`);
    expect(progress[0]).toBeGreaterThanOrEqual(partial);
    expect(readFileSync(spec().dest).equals(BODY)).toBe(true);
  });

  it("сервер не знает Range и отдаёт файл целиком — докачка превращается в загрузку с нуля, файл верный", async () => {
    const { dest } = spec();
    await seedPart(dest, BODY.subarray(0, 1000));
    behaviour = { ignoreRange: true };
    await downloadFile(spec(), { freeBytes: plenty });
    expect(readFileSync(dest).equals(BODY)).toBe(true);
  });

  it("416 на докачку: часть выбрасывается, загрузка идёт заново", async () => {
    const { dest } = spec();
    await seedPart(dest, BODY.subarray(0, 5000));
    behaviour = { rangeNotSatisfiable: true };
    await expect(downloadFile(spec(), { freeBytes: plenty })).resolves.toBeUndefined();
    expect(readFileSync(dest).equals(BODY)).toBe(true);
  });

  it("неверная сумма — SHA256_MISMATCH, ни файла, ни .part", async () => {
    await expect(
      downloadFile({ ...spec(), sha256: "0".repeat(64) }, { freeBytes: plenty }),
    ).rejects.toMatchObject({ code: "SHA256_MISMATCH", retryable: true });
    expect(existsSync(spec().dest)).toBe(false);
    expect(existsSync(`${spec().dest}.part`)).toBe(false);
  });

  it("готовый файл нужного размера не скачивается заново", async () => {
    await downloadFile(spec(), { freeBytes: plenty });
    requests.length = 0;
    await downloadFile(spec(), { freeBytes: plenty });
    expect(requests).toEqual([]);
  });

  it("мало места — NO_SPACE до единого запроса", async () => {
    await expect(
      downloadFile(spec(), { freeBytes: async () => BODY.length + SPACE_MARGIN - 1 }),
    ).rejects.toMatchObject({ code: "NO_SPACE", retryable: false });
    expect(requests).toEqual([]);
  });

  it("часть уже скачана — места нужно только на остаток", async () => {
    const { dest } = spec();
    await import("node:fs/promises").then(async (fs) => {
      await fs.mkdir(join(dir, "m"), { recursive: true });
      await fs.writeFile(`${dest}.part`, BODY.subarray(0, 250_000));
    });
    await downloadFile(spec(), { freeBytes: async () => 50_000 + SPACE_MARGIN });
    expect(readFileSync(dest).equals(BODY)).toBe(true);
  });

  it("404 — не повторять; 503 — повторять; сервер недоступен — NETWORK", async () => {
    behaviour = { status: 404 };
    await expect(downloadFile(spec(), { freeBytes: plenty })).rejects.toMatchObject({
      code: "HTTP_404",
      retryable: false,
    });
    behaviour = { status: 503 };
    await expect(downloadFile(spec(), { freeBytes: plenty })).rejects.toMatchObject({
      code: "HTTP_503",
      retryable: true,
    });
    await expect(
      downloadFile({ ...spec(), url: "http://127.0.0.1:1/x" }, { freeBytes: plenty }),
    ).rejects.toBeInstanceOf(ModelDownloadError);
  });

  it("остановка (AbortSignal) не превращается в сетевую ошибку", async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(
      downloadFile(spec(), { freeBytes: plenty, signal: stop.signal }),
    ).rejects.not.toBeInstanceOf(ModelDownloadError);
  });
});
