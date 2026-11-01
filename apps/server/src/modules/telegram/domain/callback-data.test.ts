// NOTIF-05, SEC-04: данные кнопки — действие и uuid, не больше 64 байт; чужая форма не разбирается.
import { describe, expect, it } from "vitest";
import {
  CALLBACK_ACTIONS,
  decodeCallback,
  encodeCallback,
  type CallbackAction,
} from "./callback-data.ts";

const id = "0194f3a2-7c1e-7b52-9a3d-4e5f6a7b8c9d";

describe("данные кнопок", () => {
  it.each(Object.keys(CALLBACK_ACTIONS) as CallbackAction[])(
    "«%s» кодируется в ≤ 64 байт и читается обратно",
    (action) => {
      const data = encodeCallback({ action, id });
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(decodeCallback(data)).toEqual({ action, id });
    },
  );

  it("чужая форма, не uuid и лишние части — не кнопка бота", () => {
    expect(decodeCallback("zz:" + id)).toBeUndefined();
    expect(decodeCallback("rk:не-uuid")).toBeUndefined();
    expect(decodeCallback(`rk:${id}:лишнее`)).toBeUndefined();
    expect(decodeCallback("")).toBeUndefined();
  });

  it("в данные кнопки нельзя положить не uuid", () => {
    expect(() => encodeCallback({ action: "receipt-confirm", id: "1; drop" })).toThrow(RangeError);
  });
});
