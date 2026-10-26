import { describe, expect, it, vi } from "vitest";
import { memoryLogger } from "../platform/logging/__fixtures__/memory-logger.ts";
import { crash, shutdown, STOP_TIMEOUT_MS } from "./run.ts";

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

describe("OBS-05: необработанная ошибка процесса", () => {
  it.each(["uncaughtException", "unhandledRejection"] as const)(
    "%s — строка process.crashed со стеком, лог дописан, код 1",
    async (source) => {
      const run = steps(async () => {});
      await crash(run.steps, new Error("сломалось"), source);
      const line = run.memory.lines().at(-1);
      expect(line).toMatchObject({ level: "fatal", msg: "process.crashed", reason: source });
      expect(line?.["err"]).toMatchObject({ type: "Error", message: "сломалось" });
      expect(JSON.stringify(line?.["err"])).toContain("run.test.ts");
      expect(run.closeLog).toHaveBeenCalledTimes(1);
      expect(run.exit).toHaveBeenCalledWith(1);
    },
  );

  it("лог не дописался — всё равно код 1", async () => {
    const run = steps(async () => {});
    run.closeLog.mockRejectedValueOnce(new Error("диск полон"));
    await expect(crash(run.steps, "не Error", "unhandledRejection")).rejects.toThrow("диск полон");
    expect(run.exit).toHaveBeenCalledWith(1);
  });
});
