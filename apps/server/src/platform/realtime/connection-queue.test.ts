import type { SiteEvent } from "@kosht/contract";
import { describe, expect, it } from "vitest";
import { ConnectionQueue, QUEUE_LIMIT } from "./connection-queue.ts";

const id1 = "0190f0a0-0000-7000-8000-000000000001";
const id2 = "0190f0a0-0000-7000-8000-000000000002";

function drain(queue: ConnectionQueue): SiteEvent[] {
  const events: SiteEvent[] = [];
  for (let event = queue.take(); event !== undefined; event = queue.take()) events.push(event);
  return events;
}

describe("NFR-21: очередь потока events.stream", () => {
  it("отдаёт события в порядке поступления", () => {
    const queue = new ConnectionQueue();
    queue.push({ type: "changed", entity: "receipt", id: id1 });
    queue.push({ type: "changed", entity: "receipt", id: id2 });
    expect(drain(queue)).toEqual([
      { type: "changed", entity: "receipt", id: id1 },
      { type: "changed", entity: "receipt", id: id2 },
    ]);
  });

  it("одинаковые (type, entity, id) схлопываются в одно событие на прежнем месте", () => {
    const queue = new ConnectionQueue();
    queue.push({ type: "changed", entity: "receipt", id: id1 });
    queue.push({ type: "changed", entity: "receipt", id: id2 });
    queue.push({ type: "changed", entity: "receipt", id: id1 });
    expect(drain(queue)).toEqual([
      { type: "changed", entity: "receipt", id: id1 },
      { type: "changed", entity: "receipt", id: id2 },
    ]);
  });

  it("повтор progress заменяет долю на свежую", () => {
    const queue = new ConnectionQueue();
    queue.push({ type: "progress", entity: "receipt", id: id1, percent: 10 });
    queue.push({ type: "progress", entity: "receipt", id: id1, percent: 60 });
    expect(drain(queue)).toEqual([{ type: "progress", entity: "receipt", id: id1, percent: 60 }]);
  });

  it("разные вид или сущность с тем же id — разные события", () => {
    const queue = new ConnectionQueue();
    queue.push({ type: "changed", entity: "receipt", id: id1 });
    queue.push({ type: "progress", entity: "receipt", id: id1 });
    queue.push({ type: "changed", entity: "transaction", id: id1 });
    expect(queue.size).toBe(3);
  });

  it("сверх предела новое событие не принимается, а повтор уже лежащего — принимается", () => {
    const queue = new ConnectionQueue(2);
    expect(queue.push({ type: "changed", entity: "receipt", id: id1 })).toBe(true);
    expect(queue.push({ type: "changed", entity: "receipt", id: id2 })).toBe(true);
    expect(queue.push({ type: "changed", entity: "transaction", id: id1 })).toBe(false);
    expect(queue.push({ type: "changed", entity: "receipt", id: id1 })).toBe(true);
    expect(queue.size).toBe(2);
  });

  it("предел по умолчанию — 1000 событий", () => {
    expect(QUEUE_LIMIT).toBe(1000);
  });

  it("пустая очередь отдаёт undefined", () => {
    expect(new ConnectionQueue().take()).toBeUndefined();
  });
});
