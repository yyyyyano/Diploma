// LAW-39: что уводит снимок в карантин — пропало больше 5% фрагментов, нет статей или шапки, сломана кодировка,
// канарейка не сошлась; нормальный снимок проходит.
import { describe, expect, it } from "vitest";
import type { ParsedAct, ParsedFragment } from "./build-fragments.ts";
import { assessSnapshot, canaryOf } from "./quarantine.ts";

function parsedWith(keys: readonly string[], articleCount = keys.length): ParsedAct {
  const fragments = keys.map((pathKey, position): ParsedFragment => ({
    pathKey,
    articleNo: null,
    position,
    kind: "norm",
    searchPath: pathKey,
    heading: null,
    body: pathKey,
    excluded: false,
    textHash: pathKey,
  }));
  return { fragments, articleCount, hasStructure: articleCount > 0 };
}

const keys = (n: number) => Array.from({ length: n }, (_, i) => `a${String(i + 1)}`);

describe("LAW-39: карантин снимка", () => {
  it("нормальный снимок без причин", () => {
    const reasons = assessSnapshot({
      title: "Закон",
      parsed: parsedWith(keys(40)),
      pageText: "Статья 1. Права",
      previousPaths: new Set(keys(40)),
    });
    expect(reasons).toEqual([]);
  });

  it("нет шапки и нет статей", () => {
    expect(assessSnapshot({ title: " ", parsed: parsedWith([], 0), pageText: "текст" })).toEqual([
      "no-header",
      "no-structure",
    ]);
  });

  it("сломанная кодировка: символы замены и «кракозябры»", () => {
    const base = { title: "Закон", parsed: parsedWith(keys(3)) };
    expect(assessSnapshot({ ...base, pageText: `${"�".repeat(5)}${"а".repeat(100)}` })).toEqual([
      "broken-encoding",
    ]);
    expect(assessSnapshot({ ...base, pageText: "Ð¡Ñ‚Ð°Ñ‚ÑŒÑ Ð Ð Ð Ñ Ñ‚".repeat(2) })).toContain(
      "broken-encoding",
    );
  });

  it("пропало больше 5% фрагментов — карантин, ровно 5% — ещё нет", () => {
    const previous = new Set(keys(100));
    const common = { title: "Закон", pageText: "текст", previousPaths: previous };
    expect(assessSnapshot({ ...common, parsed: parsedWith(keys(94)) })).toEqual(["fragments-lost"]);
    expect(assessSnapshot({ ...common, parsed: parsedWith(keys(95)) })).toEqual([]);
  });

  it("канарейка: у Закона № 90-З ровно 51 статья и свой заголовок", () => {
    const canary = canaryOf("H10200090");
    expect(canary?.articleCount).toBe(51);
    const title = "Закон «О защите прав потребителей»";
    expect(
      assessSnapshot({
        title,
        parsed: parsedWith(keys(51)),
        pageText: "т",
        ...(canary ? { canary } : {}),
      }),
    ).toEqual([]);
    expect(
      assessSnapshot({
        title,
        parsed: parsedWith(keys(50)),
        pageText: "т",
        ...(canary ? { canary } : {}),
      }),
    ).toEqual(["canary-mismatch"]);
    expect(
      assessSnapshot({
        title: "Другой акт",
        parsed: parsedWith(keys(51)),
        pageText: "т",
        ...(canary ? { canary } : {}),
      }),
    ).toEqual(["canary-mismatch"]);
  });

  it("у актов вне списка канарейки нет", () => {
    expect(canaryOf("Hk0900071")).toBeUndefined();
  });
});
