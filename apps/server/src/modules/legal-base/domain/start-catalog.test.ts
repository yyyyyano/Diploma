// SPEC §6.19.1: стартовый каталог — 28 актов, 23 с текстом и 5 только карточкой, ID уникальны.
import { describe, expect, it } from "vitest";
import { isNpa, START_CATALOG } from "./start-catalog.ts";

describe("LAW-10: стартовый каталог", () => {
  it("28 актов: 23 текстом и 5 карточкой", () => {
    expect(START_CATALOG).toHaveLength(28);
    expect(START_CATALOG.filter((a) => a.hasText)).toHaveLength(23);
    expect(START_CATALOG.filter((a) => !a.hasText)).toHaveLength(5);
  });

  it("ID на pravo.by не повторяются и похожи на ID (буква + цифры)", () => {
    const ids = START_CATALOG.map((a) => a.pravoId);
    expect(new Set(ids).size).toBe(28);
    expect(ids.every((id) => /^[A-Za-z]{1,2}\d{7,8}$/.test(id))).toBe(true);
  });

  it("Пленум — не НПА (LAW-04), остальные — НПА", () => {
    const plenum = START_CATALOG.filter((a) => !isNpa(a.kind));
    expect(plenum.map((a) => a.pravoId)).toEqual(["S21000004"]);
  });
});
