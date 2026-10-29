// NFR-05: Embedder поверх шлюза — вектор только через цепочку embed, длина bge-m3; хэш-эмбеддер из @kosht/testing
// подходит под тот же порт (тесты модулей, которым нужны векторы, идут без модели).
import { hashEmbedder, testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { BGE_M3_DIMENSIONS, gatewayEmbedder } from "./embedder.ts";
import type { Embedder } from "./ports.ts";

describe("NFR-05: порт Embedder", () => {
  it("шлюзовой — зовёт llm.embed с тем же вызывающим и отдаёт векторы как есть", async () => {
    const seen: unknown[] = [];
    const scope = testScope();
    const embedder = gatewayEmbedder(
      {
        embed: async (caller, texts) => {
          seen.push(caller, texts);
          return texts.map(() => [0.5]);
        },
      },
      scope,
    );
    expect(embedder.dimensions).toBe(BGE_M3_DIMENSIONS);
    expect(await embedder.embed(["а", "б"])).toEqual([[0.5], [0.5]]);
    expect(seen).toEqual([scope, ["а", "б"]]);
  });

  it("хэш-эмбеддер тестов — тот же порт (по структуре)", async () => {
    const embedder: Embedder = hashEmbedder();
    expect(embedder.dimensions).toBe(BGE_M3_DIMENSIONS);
    expect(await embedder.embed(["закон"])).toHaveLength(1);
  });
});
