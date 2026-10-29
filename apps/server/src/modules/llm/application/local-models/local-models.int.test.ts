// NFR-25, ADM-50, ARCHITECTURE §15 на Postgres: скачивание набора с прогрессом в таблице, докачка после обрыва,
// пресеты, состояние для админки и самотест с откатом на процессор. «Интернет» и llama-server — локальные HTTP-серверы
// (NFR-11); настоящие модели в этой фазе не скачиваются (решение пользователя 2026-10-29).
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../../platform/logging/__fixtures__/memory-logger.ts";
import type { CatalogModel } from "./catalog.ts";
import { makeLocalModels } from "./local-models.ts";

let db: TestDb;
let files: Server;
let llama: Server;
let filesBase: string;
let llamaBase: string;
let dir: string;

const BIG = Buffer.from(Array.from({ length: 200_000 }, (_, i) => (i * 7) % 251));
const SMALL = Buffer.from("конфиг модели");
const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

const filesState = {
  cutBig: false,
  cutDone: false,
  ranges: [] as (string | undefined)[],
  status: 200,
};

function serveFiles(request: IncomingMessage, response: ServerResponse): void {
  if (filesState.status !== 200) return void response.writeHead(filesState.status).end();
  const body = request.url === "/big" ? BIG : SMALL;
  const range = request.headers.range;
  filesState.ranges.push(range);
  const match = /^bytes=(\d+)-$/.exec(range ?? "");
  if (match !== null) {
    const start = Number(match[1]);
    response.writeHead(206, {
      "content-range": `bytes ${String(start)}-${String(body.length - 1)}/${String(body.length)}`,
    });
    return void response.end(body.subarray(start));
  }
  response.writeHead(200, { "content-length": String(body.length) });
  if (request.url === "/big" && filesState.cutBig && !filesState.cutDone) {
    filesState.cutDone = true;
    response.write(body.subarray(0, 50_000));
    setTimeout(() => response.destroy(), 20);
    return;
  }
  response.end(body);
}

/** llama-server: чат и эмбеддинги отвечают по режиму; запросы роутера записываются. */
const llamaState = {
  chat: "4",
  embeddings: "good" as "good" | "garbage",
  calls: [] as string[],
  garbageUntilCpu: false,
};
function vector(seed: number[]): number[] {
  return Array.from({ length: 1024 }, (_, i) => seed[i % seed.length] ?? 0);
}
function serveLlama(request: IncomingMessage, response: ServerResponse): void {
  llamaState.calls.push(`${request.method ?? ""} ${request.url ?? ""}`);
  let raw = "";
  request.on("data", (chunk: Buffer) => (raw += chunk.toString()));
  request.on("end", () => {
    const json = (value: unknown) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.url === "/v1/chat/completions") {
      const cpu = readFileSync(join(dir, "presets.ini"), "utf8").includes("n-gpu-layers = 0");
      const answer = llamaState.garbageUntilCpu && !cpu ? "#@!%" : llamaState.chat;
      return json({ choices: [{ message: { content: answer } }] });
    }
    if (request.url === "/v1/embeddings") {
      const cpu = readFileSync(join(dir, "presets.ini"), "utf8").includes("n-gpu-layers = 0");
      const good = llamaState.embeddings === "good" || (llamaState.garbageUntilCpu && cpu);
      // «кошка» и «кот» почти совпадают, «налог» — в стороне; мусор — одинаковые нули
      const data = good
        ? [vector([1, 0.2, 0.1]), vector([1, 0.25, 0.1]), vector([0.1, 1, 0.9])]
        : [vector([0]), vector([0]), vector([0])];
      return json({ data: data.map((embedding) => ({ embedding })) });
    }
    json({ success: true });
  });
}

beforeAll(async () => {
  db = await createTestDb();
  files = createServer(serveFiles);
  llama = createServer(serveLlama);
  await Promise.all(
    [files, llama].map(
      (server) => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
    ),
  );
  filesBase = `http://127.0.0.1:${String((files.address() as AddressInfo).port)}`;
  llamaBase = `http://127.0.0.1:${String((llama.address() as AddressInfo).port)}/v1`;
});
afterAll(async () => {
  files.close();
  llama.close();
  await db.drop();
});

const catalog = (): CatalogModel[] => [
  {
    id: "qwen3.5-4b",
    kind: "chat",
    files: [
      { path: "llm/big.bin", url: `${filesBase}/big`, sha256: sha(BIG), size: BIG.length },
      { path: "llm/small.json", url: `${filesBase}/small`, sha256: sha(SMALL), size: SMALL.length },
    ],
  },
];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kosht-models-"));
  Object.assign(filesState, { cutBig: false, cutDone: false, ranges: [], status: 200 });
  Object.assign(llamaState, { chat: "4", embeddings: "good", calls: [], garbageUntilCpu: false });
  await db.owner.query("delete from llm_local_models");
});

function setup(options: { baseUrl?: string; download?: boolean } = {}) {
  const clock = new FakeClock("2026-10-29T09:00:00Z");
  const logs = memoryLogger();
  const ready: (readonly string[])[] = [];
  const progress: number[] = [];
  const models = makeLocalModels({
    platform: {
      system: createSystemDb(db.pool),
      clock,
      log: logs.log,
      modelsDir: dir,
      settings: {
        get: async (def: { key: string }) =>
          def.key === "llm.models-download"
            ? options.download !== false
            : (options.baseUrl ?? llamaBase),
      } as never,
    },
    catalog: catalog(),
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
  });
  const ctx = {
    signal: new AbortController().signal,
    progress: async (p: number) => void progress.push(p),
    ready: async (ids: readonly string[]) => void ready.push(ids),
  };
  return { models, clock, logs, ready, progress, ctx };
}

describe("NFR-25: скачивание набора моделей", () => {
  it("загрузка выключена настройкой (тесты, e2e): ни запроса в сеть, ни файлов, ни событий", async () => {
    const { models, ctx, ready } = setup({ baseUrl: "http://127.0.0.1:1/v1", download: false });
    await models.download(ctx);
    expect(filesState.ranges).toEqual([]);
    expect(existsSync(join(dir, "llm/big.bin"))).toBe(false);
    expect(ready).toEqual([]);
    expect((await models.view()).state).toBe("absent");
  });

  it("до скачивания — «нет»; после — все файлы на диске, «готово», прогресс 100, пресеты записаны, событие «готовы»", async () => {
    const { models, ready, progress, ctx } = setup({ baseUrl: "http://127.0.0.1:1/v1" });
    expect(await models.view()).toMatchObject({ state: "absent", bytesDone: 0 });
    await models.download(ctx);
    const view = await models.view();
    expect(view).toMatchObject({ state: "ready", bytesDone: BIG.length + SMALL.length });
    expect(view.models[0]?.files.map((file) => file.state)).toEqual(["ready", "ready"]);
    expect(readFileSync(join(dir, "llm/big.bin")).equals(BIG)).toBe(true);
    expect(progress.at(-1)).toBe(100);
    expect(readFileSync(join(dir, "presets.ini"), "utf8")).toContain("[qwen3.5-4b]");
    expect(ready).toHaveLength(1);
    expect(ready[0]).toHaveLength(2);
    // llama-server не запущен — самотест «сервис не запущен», а не «мусор»
    expect(view.selfTest).toMatchObject({ state: "down" });
  });

  it("обрыв посреди большого файла: попытка падает retryable, состояние «ошибка NETWORK»; повтор докачивает по Range", async () => {
    const { models, ctx } = setup({ baseUrl: "http://127.0.0.1:1/v1" });
    filesState.cutBig = true;
    await expect(models.download(ctx)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const failed = await models.view();
    expect(failed.state).toBe("failed");
    expect(failed.models[0]).toMatchObject({ errorCode: "NETWORK" });

    await models.download(ctx);
    expect(filesState.ranges.some((range) => /^bytes=\d+-$/.test(range ?? ""))).toBe(true);
    expect((await models.view()).state).toBe("ready");
    expect(readFileSync(join(dir, "llm/big.bin")).equals(BIG)).toBe(true);
    expect(existsSync(join(dir, "llm/big.bin.part"))).toBe(false);
  });

  it("404 у источника — не повторять (INTERNAL), код в состоянии без текста", async () => {
    const { models, ctx, logs } = setup({ baseUrl: "http://127.0.0.1:1/v1" });
    filesState.status = 404;
    await expect(models.download(ctx)).rejects.toMatchObject({ code: "INTERNAL" });
    expect((await models.view()).models[0]).toMatchObject({
      state: "failed",
      errorCode: "HTTP_404",
    });
    expect(logs.lines().some((line) => line["msg"] === "llm.model-download-failed")).toBe(true);
  });

  it("второй загрузчик не стартует, пока первый жив (свежая строка «скачивается»): файлы не скачиваются дважды", async () => {
    const { models, ctx } = setup({ baseUrl: "http://127.0.0.1:1/v1" });
    await db.owner.query(
      `insert into llm_local_models (file, model, status, bytes_done, bytes_total, updated_at)
       values ('llm/big.bin', 'qwen3.5-4b', 'downloading', 1000, ${String(BIG.length)}, '2026-10-29T09:00:00Z')`,
    );
    await models.download(ctx);
    expect(filesState.ranges).toEqual([]);
    expect(existsSync(join(dir, "llm/big.bin"))).toBe(false);
  });

  it("«скачивается» без новостей дольше минуты — «ожидает»: worker умер, вечной загрузки не показываем", async () => {
    const { models, clock } = setup({ baseUrl: "http://127.0.0.1:1/v1" });
    await db.owner.query(
      `insert into llm_local_models (file, model, status, bytes_done, bytes_total, updated_at)
       values ('llm/big.bin', 'qwen3.5-4b', 'downloading', 1000, ${String(BIG.length)}, '2026-10-29T08:59:50Z')`,
    );
    expect((await models.view()).models[0]?.state).toBe("downloading");
    clock.advance(61_000);
    expect((await models.view()).models[0]?.state).toBe("pending");
  });
});

describe("ARCHITECTURE §15: самотест при старте", () => {
  it("модели отвечают разумно — «ок»; роутер ничего не выгружал", async () => {
    const { models } = setup();
    await models.writePresets(false);
    expect(await models.selfTest()).toEqual({ state: "ok", problem: null, cpuFallback: false });
    expect(llamaState.calls.some((call) => call.includes("unload"))).toBe(false);
  });

  it("мусор на видеоядре: пресеты переписаны «всё на процессоре», роутер перечитал и выгрузил, повтор — «ок, запасной режим»", async () => {
    const { models } = setup();
    llamaState.garbageUntilCpu = true;
    await models.writePresets(false);
    expect(await models.selfTest()).toEqual({ state: "ok", problem: null, cpuFallback: true });
    expect(readFileSync(join(dir, "presets.ini"), "utf8")).toContain("n-gpu-layers = 0");
    expect(
      llamaState.calls.filter((call) => call.includes("/models/unload")).length,
    ).toBeGreaterThan(0);
    expect(llamaState.calls.some((call) => call.includes("/models?reload=1"))).toBe(true);
  });

  it("мусор и на процессоре — «сбой» с кодом проблемы", async () => {
    const { models } = setup();
    llamaState.chat = "#@!%";
    await models.writePresets(false);
    expect(await models.selfTest()).toEqual({
      state: "failed",
      problem: "CHAT_GARBAGE",
      cpuFallback: false,
    });
  });

  it("мусорные эмбеддинги (нули) — EMBED_GARBAGE", async () => {
    const { models } = setup();
    llamaState.embeddings = "garbage";
    await models.writePresets(false);
    expect((await models.selfTest()).problem).toBe("EMBED_GARBAGE");
  });

  it("сервис не запущен — «не запущен», запасной режим не включается", async () => {
    const { models } = setup({ baseUrl: "http://127.0.0.1:1/v1" });
    await models.writePresets(false);
    expect(await models.selfTest()).toEqual({
      state: "down",
      problem: "LLAMA_DOWN",
      cpuFallback: false,
    });
    expect(readFileSync(join(dir, "presets.ini"), "utf8")).not.toContain("n-gpu-layers = 0");
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));
