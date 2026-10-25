// CHAT-02, ARCHITECTURE §8.3: реестр запусков — запуск не привязан к подписчику, «Стоп» — по ключу домохозяйства,
// остановка процесса доводит запуски в пределах срока и обрывает оставшиеся.
import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { createRunRegistry } from "./runs.ts";

/** Поток кусков, которым управляет тест: push — кусок, end — конец; abort запуска закрывает его. */
function controlledStream(controller: AbortController) {
  let push: (chunk: UIMessageChunk) => void = () => {};
  let end: () => void = () => {};
  const stream = new ReadableStream<UIMessageChunk>({
    start(c) {
      push = (chunk) => c.enqueue(chunk);
      end = () => c.close();
      controller.signal.addEventListener("abort", () => {
        c.enqueue({ type: "abort" });
        c.close();
      });
    },
  });
  return { stream, push: (chunk: UIMessageChunk) => push(chunk), end: () => end() };
}

async function read(stream: ReadableStream<UIMessageChunk> | undefined, count = Infinity) {
  if (stream === undefined) throw new Error("нет подписки");
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  while (chunks.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  reader.releaseLock();
  return chunks;
}

const text = (delta: string): UIMessageChunk => ({ type: "text-delta", id: "t", delta });

describe("CHAT-02: запуск не привязан к соединению", () => {
  it("подписчик получает куски с первого, даже пришедшие до подписки", async () => {
    const runs = createRunRegistry(memoryLogger().log);
    const controller = new AbortController();
    const run = controlledStream(controller);
    runs.start("h1:r1", run.stream, controller);
    run.push(text("Вот "));
    const subscription = runs.subscribe("h1:r1");
    run.push(text("счета"));
    run.end();
    expect(await read(subscription)).toEqual([text("Вот "), text("счета")]);
  });

  it("подписчик ушёл (cancel) — запуск продолжается, второй подписчик видит всё", async () => {
    const runs = createRunRegistry(memoryLogger().log);
    const controller = new AbortController();
    const run = controlledStream(controller);
    runs.start("h1:r1", run.stream, controller);
    const first = runs.subscribe("h1:r1");
    run.push(text("1"));
    expect(await read(first, 1)).toEqual([text("1")]);
    await first?.cancel();
    expect(controller.signal.aborted).toBe(false);
    run.push(text("2"));
    const second = runs.subscribe("h1:r1");
    run.end();
    expect(await read(second)).toEqual([text("1"), text("2")]);
  });
});

describe("CHAT-02: «Стоп»", () => {
  it("по своему ключу — запуск оборван; чужой или законченный ключ — false", async () => {
    const runs = createRunRegistry(memoryLogger().log);
    const controller = new AbortController();
    const run = controlledStream(controller);
    runs.start("h1:r1", run.stream, controller);
    expect(runs.stop("h2:r1")).toBe(false);
    const subscription = runs.subscribe("h1:r1");
    expect(runs.stop("h1:r1")).toBe(true);
    expect(await read(subscription)).toEqual([{ type: "abort" }]);
    expect(runs.size).toBe(0);
    expect(runs.stop("h1:r1")).toBe(false);
  });
});

describe("ADR-0015: остановка процесса", () => {
  it("законченный в срок запуск не обрывается", async () => {
    const runs = createRunRegistry(memoryLogger().log);
    const controller = new AbortController();
    const run = controlledStream(controller);
    runs.start("h1:r1", run.stream, controller);
    const stopping = runs.shutdown(1_000);
    run.end();
    await stopping;
    expect(controller.signal.aborted).toBe(false);
  });

  it("не успел за срок — оборван (abort), реестр пуст, в лог — chat.runs-aborted", async () => {
    const memory = memoryLogger();
    const runs = createRunRegistry(memory.log);
    const controller = new AbortController();
    runs.start("h1:r1", controlledStream(controller).stream, controller);
    await runs.shutdown(10);
    expect(controller.signal.aborted).toBe(true);
    expect(runs.size).toBe(0);
    expect(memory.lines().map((line) => line["msg"])).toContain("chat.runs-aborted");
  });
});
