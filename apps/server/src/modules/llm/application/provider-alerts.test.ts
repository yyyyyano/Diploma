// NOTIF-03: уведомление администратору о провайдере ИИ — ключ «провайдер + вид + день», параметры без лишнего.
import { FakeClock } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { makeProviderAlerts } from "./provider-alerts.ts";

function setup(at: string) {
  const sent: unknown[] = [];
  const clock = new FakeClock(at);
  const alert = makeProviderAlerts({
    clock,
    notifications: {
      notifyAdmins: async (input) => {
        sent.push(input);
        return undefined;
      },
    },
  });
  return { alert, sent, clock };
}

describe("NOTIF-03: уведомление об исчерпании лимита и ошибках провайдера", () => {
  it("вид ai-provider, ключ — провайдер, вид события и день", async () => {
    const { alert, sent } = setup("2026-10-29T09:00:00Z");
    await alert({ kind: "limit", provider: "groq", model: "groq/openai/gpt-oss-120b" });
    expect(sent).toEqual([
      {
        kind: "ai-provider",
        key: "groq:limit:2026-10-29",
        params: { provider: "groq", reason: "limit" },
      },
    ]);
  });

  it("на следующий день ключ новый; у ошибки и лимита — разные", async () => {
    const { alert, sent, clock } = setup("2026-10-29T09:00:00Z");
    await alert({ kind: "error", provider: "zai", model: "zai/glm-4.7-flash" });
    clock.set("2026-10-30T09:00:00Z");
    await alert({ kind: "error", provider: "zai", model: "zai/glm-4.7-flash" });
    await alert({ kind: "limit", provider: "zai", model: "zai/glm-4.7-flash" });
    expect(sent.map((item) => (item as { key: string }).key)).toEqual([
      "zai:error:2026-10-29",
      "zai:error:2026-10-30",
      "zai:limit:2026-10-30",
    ]);
  });
});
