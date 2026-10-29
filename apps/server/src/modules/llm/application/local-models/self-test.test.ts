// NFR-25: самотест чистой функцией на подставном fetch — что считается «мусором», а что «сервис не запущен».
import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, runSelfTest } from "./self-test.ts";

const vec = (...seed: number[]) =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => seed[i % seed.length] ?? 0);

function server(chat: string, embeddings: number[][]): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/chat/completions"))
      return Response.json({ choices: [{ message: { content: chat } }] });
    return Response.json({ data: embeddings.map((embedding) => ({ embedding })) });
  };
}
const deps = { baseUrl: "http://llama/v1", chatModel: "qwen3.5-4b", embedModel: "bge-m3" };
const good = [vec(1, 0.2), vec(1, 0.25), vec(0.1, 1)];

describe("самотест локальных моделей", () => {
  it.each(["4", "Ответ: 4.", "2+2=4"])("«%s» и осмысленные векторы — ок", async (answer) => {
    expect(await runSelfTest({ ...deps, fetch: server(answer, good) })).toEqual({
      ok: true,
      problems: [],
    });
  });

  it.each(["", "5", "#@!%", "14"])("чат отвечает «%s» — CHAT_GARBAGE", async (answer) => {
    expect((await runSelfTest({ ...deps, fetch: server(answer, good) })).problems).toEqual([
      "CHAT_GARBAGE",
    ]);
  });

  it("векторы: не тот размер, NaN, нули и «кошка» не ближе к «коту» — EMBED_GARBAGE", async () => {
    for (const bad of [
      [[1], [1], [1]],
      [vec(Number.NaN), vec(1), vec(1)],
      [vec(0), vec(0), vec(0)],
      [vec(0.1, 1), vec(1, 0.2), vec(1, 0.25)],
    ]) {
      expect((await runSelfTest({ ...deps, fetch: server("4", bad) })).problems).toEqual([
        "EMBED_GARBAGE",
      ]);
    }
  });

  it("сервис не отвечает или отвечает ошибкой — LLAMA_DOWN, а не «мусор»", async () => {
    const refuse: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await runSelfTest({ ...deps, fetch: refuse })).toEqual({
      ok: false,
      problems: ["LLAMA_DOWN"],
    });
    const failing: typeof fetch = async () => new Response("", { status: 503 });
    expect((await runSelfTest({ ...deps, fetch: failing })).problems).toEqual(["LLAMA_DOWN"]);
  });
});
