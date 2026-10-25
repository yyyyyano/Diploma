import type { SiteEvent } from "@kosht/contract";
import { testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { createRealtimeHub, STREAMS_PER_USER, type RealtimeHubDeps } from "./hub.ts";
import type { RealtimeMessage } from "./message.ts";

const scopeA = testScope({ user: 1, household: 1 });
const scopeA2 = testScope({ user: 3, household: 1 });
const scopeB = testScope({ user: 2, household: 2 });

function uuid(n: number): string {
  return `0190f0a0-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
}

function changed(householdId: string, ...ids: string[]): RealtimeMessage {
  return { householdId, type: "changed", entity: "receipt", ids };
}

function hub(options: Omit<RealtimeHubDeps, "log"> = {}) {
  const memory = memoryLogger();
  return { hub: createRealtimeHub({ log: memory.log, ...options }), memory };
}

describe("ROLE-01, SEC-04: поток получает только сигналы своего домохозяйства", () => {
  it("сигнал B не доходит до потока A: часовой A приходит первым и единственным", async () => {
    const { hub: realtime } = hub();
    const stream = realtime.open(scopeA, new AbortController().signal);
    const first = stream.next();
    realtime.deliver(changed(scopeB.householdId, uuid(1)));
    realtime.deliver(changed(scopeA.householdId, uuid(2)));
    expect(await first).toEqual({
      done: false,
      value: { type: "changed", entity: "receipt", id: uuid(2) },
    });
  });

  it("сигнал домохозяйства доходит до потоков всех его пользователей", async () => {
    const { hub: realtime } = hub();
    const a = realtime.open(scopeA, new AbortController().signal);
    const a2 = realtime.open(scopeA2, new AbortController().signal);
    const nextA = a.next();
    const nextA2 = a2.next();
    realtime.deliver(changed(scopeA.householdId, uuid(1)));
    expect((await nextA).value).toEqual({ type: "changed", entity: "receipt", id: uuid(1) });
    expect((await nextA2).value).toEqual({ type: "changed", entity: "receipt", id: uuid(1) });
  });

  it("пачка id — событие на каждый id; progress несёт долю", async () => {
    const { hub: realtime } = hub();
    const stream = realtime.open(scopeA, new AbortController().signal);
    const first = stream.next();
    realtime.deliver(changed(scopeA.householdId, uuid(1), uuid(2)));
    realtime.deliver({
      householdId: scopeA.householdId,
      type: "progress",
      entity: "receipt",
      ids: [uuid(3)],
      percent: 40,
    });
    const received: SiteEvent[] = [(await first).value as SiteEvent];
    for (let n = 0; n < 2; n += 1) received.push((await stream.next()).value as SiteEvent);
    expect(received).toEqual([
      { type: "changed", entity: "receipt", id: uuid(1) },
      { type: "changed", entity: "receipt", id: uuid(2) },
      { type: "progress", entity: "receipt", id: uuid(3), percent: 40 },
    ]);
  });
});

describe("NFR-21: как заканчивается поток", () => {
  it("abort запроса или остановки процесса — поток возвращает closed и уходит из хаба", async () => {
    const { hub: realtime } = hub();
    const request = new AbortController();
    const stream = realtime.open(scopeA, request.signal);
    const next = stream.next();
    expect(realtime.size).toBe(1);
    request.abort();
    expect(await next).toEqual({ done: true, value: "closed" });
    expect(realtime.size).toBe(0);
  });

  it("return() во время ожидания события закрывает поток сразу: ждущий next() получает конец", async () => {
    const { hub: realtime } = hub();
    const stream = realtime.open(scopeA, new AbortController().signal);
    const waiting = stream.next();
    expect(await stream.return()).toEqual({ done: true, value: "closed" });
    expect(await waiting).toEqual({ done: true, value: "closed" });
    expect(realtime.size).toBe(0);
  });

  it("сигнал уже отменён — поток сразу заканчивается", async () => {
    const { hub: realtime } = hub();
    expect(await realtime.open(scopeA, AbortSignal.abort()).next()).toEqual({
      done: true,
      value: "closed",
    });
  });

  it("closeAll закрывает все потоки с причиной", async () => {
    const { hub: realtime } = hub();
    const a = realtime.open(scopeA, new AbortController().signal).next();
    const b = realtime.open(scopeB, new AbortController().signal).next();
    realtime.closeAll("reconnect");
    expect(await a).toEqual({ done: true, value: "reconnect" });
    expect(await b).toEqual({ done: true, value: "reconnect" });
    expect(realtime.size).toBe(0);
  });

  it("переполнение очереди закрывает каждый переполненный поток с overflow и убирает его из хаба", async () => {
    const { hub: realtime, memory } = hub({ queueLimit: 2 });
    const slow = realtime.open(scopeA, new AbortController().signal);
    const started = slow.next();
    realtime.deliver(changed(scopeA.householdId, uuid(1)));
    await started;
    const other = realtime.open(scopeA2, new AbortController().signal);
    const otherNext = other.next();
    realtime.deliver(changed(scopeA.householdId, uuid(2), uuid(3), uuid(4)));
    expect(await slow.next()).toEqual({ done: true, value: "overflow" });
    expect(memory.lines().at(-1)).toMatchObject({ msg: "realtime.stream-overflow", limit: 2 });
    expect(await otherNext).toEqual({ done: true, value: "overflow" });
    expect(realtime.size).toBe(0);
  });

  it("повторы одного id схлопываются и не переполняют очередь", async () => {
    const { hub: realtime } = hub({ queueLimit: 1 });
    const stream = realtime.open(scopeA, new AbortController().signal);
    const started = stream.next();
    realtime.deliver(changed(scopeA.householdId, uuid(1)));
    await started;
    for (let n = 0; n < 5; n += 1) realtime.deliver(changed(scopeA.householdId, uuid(2)));
    expect(await stream.next()).toEqual({
      done: false,
      value: { type: "changed", entity: "receipt", id: uuid(2) },
    });
  });
});

describe("NFR-21: не больше 8 потоков на пользователя", () => {
  it("девятый поток закрывает самый старый поток этого пользователя, чужие не трогает", async () => {
    const { hub: realtime, memory } = hub();
    const other = realtime.open(scopeA2, new AbortController().signal);
    const otherNext = other.next();
    const own = Array.from({ length: STREAMS_PER_USER }, () =>
      realtime.open(scopeA, new AbortController().signal),
    );
    const pending = own.map((stream) => stream.next());
    expect(realtime.size).toBe(STREAMS_PER_USER + 1);

    const ninth = realtime.open(scopeA, new AbortController().signal);
    const ninthNext = ninth.next();
    expect(await pending[0]).toEqual({ done: true, value: "replaced" });
    expect(memory.lines().at(-1)).toMatchObject({ msg: "realtime.stream-replaced", limit: 8 });
    expect(realtime.size).toBe(STREAMS_PER_USER + 1);

    realtime.deliver(changed(scopeA.householdId, uuid(1)));
    const event = { done: false, value: { type: "changed", entity: "receipt", id: uuid(1) } };
    expect(await ninthNext).toEqual(event);
    expect(await pending[1]).toEqual(event);
    expect(await otherNext).toEqual(event);
  });

  it("предел — 8", () => {
    expect(STREAMS_PER_USER).toBe(8);
  });
});
