// LLM-05: разбор длительностей из заголовков x-ratelimit-* и retry-after, окна лимитов и размыкатель без цепочки.
import { APICallError } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { createLimiter, DEFAULT_RETRY_AFTER_MS, parseDurationMs } from "./limiter.ts";

describe("LLM-05: длительности из заголовков провайдера", () => {
  it.each([
    ["1m26.4s", 86_400],
    ["2.085s", 2085],
    ["250ms", 250],
    ["1h2m3s", 3_723_000],
    ["30", 30_000],
    ["0.5", 500],
  ])("«%s» — %i мс", (text, ms) => {
    expect(parseDurationMs(text)).toBe(ms);
  });

  it.each(["", "скоро", "5 минут", "1m foo", undefined])("«%s» не разобрана", (text) => {
    expect(parseDurationMs(text)).toBeUndefined();
  });
});

describe("LLM-05: окна лимитов", () => {
  const free = { rpm: null, tpm: null, rpd: null, tpd: null };
  const window = { requestsMinute: 0, tokensMinute: 0, requestsDay: 0, tokensDay: 0 };

  it("суточный лимит токенов: расход по журналу и оценка вызова не помещаются в tpd", async () => {
    const limiter = createLimiter({
      now: () => new Date(),
      usage: async () => new Map([["groq/a", { ...window, tokensDay: 199_900 }]]),
    });
    const model = { id: "groq/a", limits: { ...free, tpd: 200_000 } };
    expect(await limiter.check(model, 50)).toBeUndefined();
    expect(await limiter.check(model, 200)).toEqual({ kind: "tpd" });
  });

  it("запрос в полёте освобождает место, когда его отпустили", async () => {
    const limiter = createLimiter({ now: () => new Date(), usage: async () => new Map() });
    const model = { id: "groq/a", limits: { ...free, rpm: 1 } };
    const release = limiter.reserve("groq/a", 100);
    expect(await limiter.check(model, 10)).toEqual({ kind: "rpm" });
    release();
    release();
    expect(await limiter.check(model, 10)).toBeUndefined();
  });

  it("429 разных видов: без retry-after — минута; не 429 — размыкателя нет", async () => {
    let now = 0;
    const limiter = createLimiter({ now: () => new Date(now), usage: async () => new Map() });
    const failure = (statusCode: number) =>
      new APICallError({ message: "x", url: "u", requestBodyValues: {}, statusCode });
    expect(limiter.rejected("groq/a", failure(500))).toBe(false);
    expect(await limiter.check({ id: "groq/a", limits: free }, 1)).toBeUndefined();
    expect(limiter.rejected("groq/a", failure(429))).toBe(true);
    expect(await limiter.check({ id: "groq/a", limits: free }, 1)).toEqual({ kind: "retry-after" });
    now = DEFAULT_RETRY_AFTER_MS;
    expect(await limiter.check({ id: "groq/a", limits: free }, 1)).toBeUndefined();
  });

  it("не APICallError (сеть, таймаут) размыкатель не включает", () => {
    const limiter = createLimiter({ now: () => new Date(), usage: async () => new Map() });
    expect(limiter.rejected("groq/a", new Error("ECONNRESET"))).toBe(false);
  });
});
