// SEC-03: разбор недоверенного файла — в потоке с таймаутом и лимитом памяти; сбой потока не роняет процесс.
import { describe, expect, it } from "vitest";
import { defineIsolatedWorker, runIsolated, SandboxError, workerUrl } from "./isolated.ts";

const echo = defineIsolatedWorker({
  name: "echo",
  devUrl: new URL("./__fixtures__/echo.worker.ts", import.meta.url),
});
const limits = { timeoutMs: 5_000, memoryMb: 64 };

describe("SEC-03: песочница разбора", () => {
  it("поток получает вход и возвращает результат", async () => {
    const result = await runIsolated<unknown, { text: string }>(
      echo,
      { mode: "echo", text: "привет" },
      limits,
    );
    expect(result).toEqual({ text: "привет" });
  });

  it("буфер из transferList доходит до потока без копирования", async () => {
    const bytes = new Uint8Array(1024);
    const result = await runIsolated<unknown, { size: number }>(
      echo,
      { mode: "bytes", bytes },
      limits,
      [bytes.buffer],
    );
    expect(result.size).toBe(1024);
    expect(bytes.byteLength).toBe(0);
  });

  it("зависший разбор прерывается по таймауту", async () => {
    const started = performance.now();
    await expect(
      runIsolated(echo, { mode: "hang" }, { timeoutMs: 300, memoryMb: 64 }),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("разбор, съевший память, падает с видом «memory», процесс жив", async () => {
    await expect(
      runIsolated(echo, { mode: "memory" }, { timeoutMs: 20_000, memoryMb: 32 }),
    ).rejects.toMatchObject({ kind: "memory" });
    // Процесс теста цел и поток запускается снова.
    expect(await runIsolated(echo, { mode: "echo", text: "ок" }, limits)).toEqual({ text: "ок" });
  });

  it("отказ по правилу приходит с кодом", async () => {
    await expect(runIsolated(echo, { mode: "reject" }, limits)).rejects.toMatchObject({
      kind: "rejected",
      code: "zip-bomb",
    });
  });

  it("исключение потока — сбой без текста исключения (в нём мог быть кусок документа)", async () => {
    const error = await runIsolated(echo, { mode: "throw" }, limits).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SandboxError);
    expect(error).toMatchObject({ kind: "failed" });
    expect((error as Error).message).not.toContain("секрет");
  });
});

describe("workerUrl", () => {
  it("из исходников (.ts) — адрес исходника рабочего файла", () => {
    expect(workerUrl(echo, "file:///src/platform/sandbox/isolated.ts")).toBe(echo.devUrl);
  });

  it("из бандла (.mjs) — <имя>.worker.mjs рядом с бандлом процесса", () => {
    expect(workerUrl(echo, "file:///app/dist/worker.mjs").href).toBe(
      "file:///app/dist/echo.worker.mjs",
    );
  });
});
