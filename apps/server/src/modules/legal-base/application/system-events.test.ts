// Системные события общей базы (законы): публикуются фасадом identity от имени первого администратора; пока актов нет —
// не публикуются (администратора нет — решает identity, см. setup.int.test.ts).
import { describe, expect, it } from "vitest";
import { actUpdated } from "../events.ts";
import { makeSystemEvents } from "./system-events.ts";

function setup() {
  const published: { name: string; ids: readonly string[] }[] = [];
  const publish = makeSystemEvents({
    publishSystemEvent: async (event, ids) => {
      published.push({ name: event.name, ids });
      return true;
    },
  });
  return { publish, published };
}

describe("системные события legal-base", () => {
  it("событие уходит пачкой id через identity.publishSystemEvent", async () => {
    const t = setup();
    await t.publish(actUpdated, ["a1", "a2"]);
    expect(t.published).toEqual([{ name: "legal-base.act-updated", ids: ["a1", "a2"] }]);
  });

  it("нет актов — события нет", async () => {
    const t = setup();
    await t.publish(actUpdated, []);
    expect(t.published).toEqual([]);
  });
});
