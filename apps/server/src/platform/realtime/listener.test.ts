import { testHouseholdId } from "@kosht/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListenConnection, ListenHandlers } from "../db/listen.ts";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import {
  createRealtimeListener,
  RealtimeStartError,
  reconnectDelayMs,
  type RealtimeListenerDeps,
} from "./listener.ts";
import type { RealtimeMessage } from "./message.ts";

const message: RealtimeMessage = {
  householdId: testHouseholdId(1),
  type: "changed",
  entity: "receipt",
  ids: ["0190f0a0-0000-7000-8000-000000000001"],
};

/** Подключение LISTEN без базы: каждая попытка — по сценарию outcomes (true — успех), время попыток — по часам. */
function fakeConnect(outcomes: boolean[]) {
  const attempts: number[] = [];
  const closed: number[] = [];
  let handlers: ListenHandlers | undefined;
  const connect = async (next: ListenHandlers): Promise<ListenConnection> => {
    attempts.push(Date.now());
    const index = attempts.length - 1;
    if (!(outcomes[index] ?? true)) throw new Error("connection refused");
    handlers = next;
    return { close: async () => void closed.push(index) };
  };
  return {
    connect,
    attempts,
    closed,
    handlers: () => {
      if (handlers === undefined) throw new Error("не подключались");
      return handlers;
    },
  };
}

function listener(connect: RealtimeListenerDeps["connect"]) {
  const memory = memoryLogger();
  const onReady = vi.fn<() => void>();
  const onLost = vi.fn<() => void>();
  const onMessage = vi.fn<(message: RealtimeMessage) => void>();
  const instance = createRealtimeListener({ connect, log: memory.log, onReady, onLost, onMessage });
  return { instance, memory, onReady, onLost, onMessage };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ADR-0008: пауза переподключения LISTEN", () => {
  it("0,2 с, затем вдвое больше, потолок 5 с", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(reconnectDelayMs)).toEqual([
      200, 400, 800, 1600, 3200, 5000, 5000, 5000,
    ]);
  });

  it("неудачные попытки идут через 0,2 → 0,4 → 0,8 → 1,6 → 3,2 → 5 → 5 с, успех сбрасывает паузу", async () => {
    const fake = fakeConnect([true, false, false, false, false, false, false, true, true]);
    const { instance, onReady, onLost } = listener(fake.connect);
    await instance.start();
    expect(onReady).toHaveBeenCalledTimes(1);

    fake.handlers().onLost(new Error("terminated"));
    expect(onLost).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    const lostAt = 0;
    expect(fake.attempts.slice(1).map((at) => at - lostAt)).toEqual([
      200, 600, 1400, 3000, 6200, 11200, 16200,
    ]);
    expect(onReady).toHaveBeenCalledTimes(2);

    const secondLoss = Date.now();
    fake.handlers().onLost(new Error("terminated"));
    await vi.runAllTimersAsync();
    expect(fake.attempts.at(-1)).toBe(secondLoss + 200);
    expect(onReady).toHaveBeenCalledTimes(3);
    await instance.stop();
  });
});

describe("ADR-0008: старт и остановка слушателя", () => {
  it("первое подключение не удалось — RealtimeStartError с текстом для консоли", async () => {
    const fake = fakeConnect([false]);
    const { instance, onReady } = listener(fake.connect);
    const error: unknown = await instance.start().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(RealtimeStartError);
    expect(String((error as Error).message)).toContain("LISTEN kosht_realtime");
    expect(onReady).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(fake.attempts).toHaveLength(1);
  });

  it("stop() закрывает соединение и пишет realtime.stopped; переподключений после него нет", async () => {
    const fake = fakeConnect([true]);
    const { instance, memory } = listener(fake.connect);
    await instance.start();
    await instance.stop();
    expect(fake.closed).toEqual([0]);
    expect(memory.lines().at(-1)).toMatchObject({ msg: "realtime.stopped" });
  });

  it("stop() во время паузы — попытки не будет", async () => {
    const fake = fakeConnect([true]);
    const { instance } = listener(fake.connect);
    await instance.start();
    fake.handlers().onLost(new Error("terminated"));
    await instance.stop();
    await vi.runAllTimersAsync();
    expect(fake.attempts).toHaveLength(1);
  });

  it("stop() во время попытки — открывшееся соединение сразу закрывается", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closed: string[] = [];
    let calls = 0;
    let handlers: ListenHandlers | undefined;
    const { instance } = listener(async (next) => {
      calls += 1;
      handlers = next;
      if (calls === 2) await gate;
      return { close: async () => void closed.push(`попытка ${String(calls)}`) };
    });
    await instance.start();
    handlers?.onLost(new Error("terminated"));
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toBe(2);
    const stopping = instance.stop();
    release();
    await stopping;
    expect(closed).toEqual(["попытка 2"]);
  });
});

describe("ADR-0008, OBS-04: входящее сообщение канала", () => {
  it("сообщение по схеме уходит получателю", async () => {
    const fake = fakeConnect([true]);
    const { instance, onMessage } = listener(fake.connect);
    await instance.start();
    fake.handlers().onNotification(JSON.stringify(message));
    expect(onMessage).toHaveBeenCalledWith(message);
    await instance.stop();
  });

  it("неверное — realtime.bad-message без текста сообщения, получателю не уходит", async () => {
    const fake = fakeConnect([true]);
    const { instance, onMessage, memory } = listener(fake.connect);
    await instance.start();
    fake.handlers().onNotification(JSON.stringify({ ...message, text: "Евроопт 12,50" }));
    expect(onMessage).not.toHaveBeenCalled();
    expect(memory.lines().at(-1)).toMatchObject({ msg: "realtime.bad-message" });
    expect(memory.text()).not.toContain("Евроопт");
    await instance.stop();
  });
});
