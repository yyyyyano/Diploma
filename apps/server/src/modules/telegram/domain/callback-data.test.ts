// NOTIF-05, SEC-04, TG-07: данные кнопки — действие и короткий аргумент, не больше 64 байт; чужая форма не разбирается.
import { describe, expect, it } from "vitest";
import { decodeCallback, encodeCallback, modelTag, type Callback } from "./callback-data.ts";

const id = "0194f3a2-7c1e-7b52-9a3d-4e5f6a7b8c9d";

const CASES: readonly Callback[] = [
  { action: "receipt-confirm", id },
  { action: "receipt-edit", id },
  { action: "receipt-cancel", id },
  { action: "statement-import", id },
  { action: "statement-cancel", id },
  { action: "decision-yes", id },
  { action: "decision-no", id },
  { action: "undo", id },
  { action: "command", id: "limits" },
  { action: "model", id: "auto" },
  { action: "model", id: modelTag("groq/openai/gpt-oss-120b") },
];

describe("данные кнопок", () => {
  it.each(CASES)("«$action» кодируется в ≤ 64 байт и читается обратно", (callback) => {
    const data = encodeCallback(callback);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(decodeCallback(data)).toEqual(callback);
  });

  it("чужая форма, не uuid, лишние части и чужие слова — не кнопка бота", () => {
    expect(decodeCallback("zz:" + id)).toBeUndefined();
    expect(decodeCallback("rk:не-uuid")).toBeUndefined();
    expect(decodeCallback(`rk:${id}:лишнее`)).toBeUndefined();
    expect(decodeCallback("cm:drop-table")).toBeUndefined();
    expect(decodeCallback("md:../../etc")).toBeUndefined();
    expect(decodeCallback("")).toBeUndefined();
  });

  it("в данные кнопки нельзя положить аргумент не той формы", () => {
    expect(() => encodeCallback({ action: "receipt-confirm", id: "1; drop" })).toThrow(RangeError);
    expect(() => encodeCallback({ action: "command", id: "format-disk" })).toThrow(RangeError);
  });

  it("метка модели — 12 знаков хэша: разные модели — разные метки, одна и та же — одна", () => {
    expect(modelTag("a/b")).toMatch(/^[0-9a-f]{12}$/);
    expect(modelTag("a/b")).toBe(modelTag("a/b"));
    expect(modelTag("a/b")).not.toBe(modelTag("a/c"));
  });
});
