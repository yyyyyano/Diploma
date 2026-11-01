// CHAT-02: реестр живых ответов — по домохозяйству и id ответа; удаление диалога останавливает его ответы.
import { describe, expect, it } from "vitest";
import { createLiveRuns } from "./live-runs.ts";

describe("CHAT-02: живые ответы процесса", () => {
  it("ответ виден только своему домохозяйству и пропадает после remove", () => {
    const runs = createLiveRuns();
    runs.add("h1", "m1", { conversationId: "c1", controller: new AbortController() });
    expect(runs.has("h1", "m1")).toBe(true);
    expect(runs.has("h2", "m1")).toBe(false);
    runs.remove("h1", "m1");
    expect(runs.has("h1", "m1")).toBe(false);
  });

  it("abortConversation останавливает ответы только этого диалога этого домохозяйства", () => {
    const runs = createLiveRuns();
    const mine = new AbortController();
    const otherDialog = new AbortController();
    const otherHousehold = new AbortController();
    runs.add("h1", "m1", { conversationId: "c1", controller: mine });
    runs.add("h1", "m2", { conversationId: "c2", controller: otherDialog });
    runs.add("h2", "m3", { conversationId: "c1", controller: otherHousehold });
    runs.abortConversation("h1", "c1");
    expect(mine.signal.aborted).toBe(true);
    expect(otherDialog.signal.aborted).toBe(false);
    expect(otherHousehold.signal.aborted).toBe(false);
  });
});
