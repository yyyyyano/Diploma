import { describe, expect, it, vi } from "vitest";
import { memoryLogger } from "../platform/logging/__fixtures__/memory-logger.ts";
import { shutdown, STOP_TIMEOUT_MS } from "./run.ts";

function steps(stop: () => Promise<void>) {
  const memory = memoryLogger();
  const exit = vi.fn<(code: number) => void>();
  const closeLog = vi.fn<() => Promise<void>>(async () => {});
  return { memory, exit, closeLog, steps: { log: memory.log, stop, closeLog, exit } };
}

describe("ADR-0015: остановка процесса по SIGTERM", () => {
  it("остановились в срок — process.stopped последней строкой, лог дописан, код 0", async () => {
    const run = steps(async () => {});
    await shutdown(run.steps, STOP_TIMEOUT_MS);
    expect(run.memory.lines().map((line) => line["msg"])).toEqual([
      "process.stopping",
      "process.stopped",
    ]);
    expect(run.closeLog).toHaveBeenCalledTimes(1);
    expect(run.exit).toHaveBeenCalledWith(0);
  });

  it("остановка зависла дольше срока — process.stop-timeout и код 1", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const run = steps(async () => new Promise<void>(() => {}));
      const done = shutdown(run.steps, 50);
      await vi.advanceTimersByTimeAsync(50);
      await done;
      expect(run.memory.lines().at(-1)).toMatchObject({ msg: "process.stop-timeout", ms: 50 });
      expect(run.closeLog).toHaveBeenCalledTimes(1);
      expect(run.exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("остановка упала — process.stop-failed со стеком и код 1", async () => {
    const run = steps(async () => {
      throw new Error("пул не закрылся");
    });
    await shutdown(run.steps, STOP_TIMEOUT_MS);
    expect(run.memory.lines().at(-1)).toMatchObject({
      msg: "process.stop-failed",
      err: { type: "Error" },
    });
    expect(run.exit).toHaveBeenCalledWith(1);
  });

  it("срок остановки — 10 с", () => {
    expect(STOP_TIMEOUT_MS).toBe(10_000);
  });
});
