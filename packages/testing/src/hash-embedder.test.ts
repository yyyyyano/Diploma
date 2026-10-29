import { describe, expect, it } from "vitest";
import { hashEmbedder } from "./hash-embedder.ts";

const cosine = (a: number[], b: number[]) =>
  a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0);

describe("хэш-эмбеддер для тестов", () => {
  it("детерминирован, нужной длины, нормирован", async () => {
    const embedder = hashEmbedder();
    const [first] = await embedder.embed(["налог на доходы физических лиц"]);
    const [again] = await embedder.embed(["налог на доходы физических лиц"]);
    expect(first).toEqual(again);
    expect(first).toHaveLength(1024);
    expect(Math.hypot(...(first ?? []))).toBeCloseTo(1, 6);
  });

  it("тексты с общими словами ближе друг к другу, чем разные", async () => {
    const [a, b, c] = await hashEmbedder().embed([
      "налог на доходы физических лиц",
      "ставка налога на доходы",
      "ремонт кровли дома",
    ]);
    expect(cosine(a ?? [], b ?? [])).toBeGreaterThan(cosine(a ?? [], c ?? []) + 0.2);
  });

  it("пустой текст — нулевой вектор, а не NaN", async () => {
    const [empty] = await hashEmbedder(16).embed([""]);
    expect(empty).toEqual(Array.from({ length: 16 }, () => 0));
  });
});
