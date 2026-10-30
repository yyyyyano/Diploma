// Системные события общей базы (законы): публикуются от имени первого администратора в одной транзакции; пока администратора
// нет или актов нет — не публикуются.
import { describe, expect, it } from "vitest";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { actUpdated } from "../events.ts";
import { makeSystemEvents } from "./system-events.ts";

function setup(admin: boolean) {
  const published: { name: string; payload: unknown; inTx: boolean }[] = [];
  let inTx = false;
  const scoped = {
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      inTx = true;
      await fn({});
      inTx = false;
    },
  } as unknown as ScopedDb;
  const publish = makeSystemEvents({
    adminScoped: async () => (admin ? scoped : undefined),
    events: {
      publish: async (_tx, event, payload) => {
        published.push({ name: event.name, payload, inTx });
      },
    },
  });
  return { publish, published };
}

describe("системные события legal-base", () => {
  it("событие уходит пачкой id в транзакции администратора", async () => {
    const t = setup(true);
    await t.publish(actUpdated, ["a1", "a2"]);
    expect(t.published).toEqual([
      { name: "legal-base.act-updated", payload: { ids: ["a1", "a2"] }, inTx: true },
    ]);
  });

  it("нет администратора или нет актов — события нет", async () => {
    const none = setup(false);
    await none.publish(actUpdated, ["a1"]);
    const empty = setup(true);
    await empty.publish(actUpdated, []);
    expect([none.published, empty.published]).toEqual([[], []]);
  });
});
