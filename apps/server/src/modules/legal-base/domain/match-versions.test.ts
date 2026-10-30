// LAW-31: новая редакция — продлить, заменить, перенумеровать, добавить, «исключён».
import { describe, expect, it } from "vitest";
import type { ParsedFragment } from "./build-fragments.ts";
import { matchVersions, type CurrentVersion } from "./match-versions.ts";

const cur = (pathKey: string, textHash: string, excluded = false): CurrentVersion => ({
  fragmentId: `f-${pathKey}`,
  versionId: `v-${pathKey}`,
  pathKey,
  textHash,
  excluded,
});
const frag = (pathKey: string, textHash: string): ParsedFragment => ({
  pathKey,
  articleNo: null,
  position: 0,
  kind: "norm",
  searchPath: pathKey,
  heading: null,
  body: textHash,
  excluded: false,
  textHash,
});

describe("LAW-31: сопоставление версий фрагментов", () => {
  it("неизменённые продлеваются, изменённая статья — ровно одна новая версия", () => {
    const plan = matchVersions(
      [cur("a1", "h1"), cur("a2", "h2"), cur("a3", "h3")],
      [frag("a1", "h1"), frag("a2", "h2-new"), frag("a3", "h3")],
    );
    expect(plan.keep.map((m) => m.next.pathKey)).toEqual(["a1", "a3"]);
    expect(plan.changed.map((m) => m.next.pathKey)).toEqual(["a2"]);
    expect([plan.added, plan.missing, plan.renumbered].map((x) => x.length)).toEqual([0, 0, 0]);
  });

  it("перенумерация: тот же текст под другим номером — не «исключена» и «добавлена», а перенос", () => {
    const plan = matchVersions(
      [cur("a5", "h5"), cur("a6", "h6")],
      [frag("a6", "h5"), frag("a7", "h6")],
    );
    expect(plan.renumbered.map((m) => [m.current.pathKey, m.next.pathKey])).toEqual([
      ["a5", "a6"],
      ["a6", "a7"],
    ]);
    expect(plan.added).toEqual([]);
    expect(plan.missing).toEqual([]);
  });

  it("новая статья — «добавлена», пропавшая без следа — «исключён»", () => {
    const plan = matchVersions(
      [cur("a1", "h1"), cur("a2", "h2")],
      [frag("a1", "h1"), frag("a9", "h9")],
    );
    expect(plan.added.map((f) => f.pathKey)).toEqual(["a9"]);
    expect(plan.missing.map((c) => c.pathKey)).toEqual(["a2"]);
  });

  it("уже исключённый фрагмент, которого по-прежнему нет, второй раз не «исключается»", () => {
    expect(matchVersions([cur("a2", "h2", true)], []).missing).toEqual([]);
  });
});
