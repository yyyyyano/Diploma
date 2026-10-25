import { testHouseholdId } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { decodeSignal, encodeSignal, NOTIFY_MAX_BYTES, RealtimeMessage } from "./message.ts";

const householdId = testHouseholdId(1);

/** n-й валидный uuid (версия 7) — детерминированно, без случайности. */
function uuid(n: number): string {
  return `0190f0a0-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
}

describe("ADR-0008: сигнал realtime режется на куски NOTIFY", () => {
  it("1000 id с сущностью из 48 символов: каждый кусок ≤ 7500 байт, все id по разу и по порядку", () => {
    const ids = Array.from({ length: 1000 }, (_, n) => uuid(n));
    const entity = `a${"-b".repeat(23)}c`;
    expect(entity).toHaveLength(48);

    const chunks = encodeSignal({ householdId, type: "changed", entity, ids });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks)
      expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(NOTIFY_MAX_BYTES);
    const decoded = chunks.map((chunk) => RealtimeMessage.parse(JSON.parse(chunk)));
    expect(decoded.flatMap((message) => message.ids)).toEqual(ids);
    expect(new Set(decoded.map((message) => message.entity))).toEqual(new Set([entity]));
    expect(new Set(decoded.map((message) => message.householdId))).toEqual(new Set([householdId]));
  });

  it("кусок заполняется до предела: следующий id в него уже не помещается", () => {
    const ids = Array.from({ length: 1000 }, (_, n) => uuid(n));
    const [first] = encodeSignal({ householdId, type: "changed", entity: "transaction", ids });
    const count = RealtimeMessage.parse(JSON.parse(first ?? "")).ids.length;
    const withNext = JSON.stringify({
      householdId,
      type: "changed",
      entity: "transaction",
      ids: ids.slice(0, count + 1),
    });
    expect(Buffer.byteLength(withNext)).toBeGreaterThan(NOTIFY_MAX_BYTES);
  });

  it("в сообщении только домохозяйство, вид, сущность, id и доля — без данных", () => {
    const [chunk] = encodeSignal({
      householdId,
      type: "progress",
      entity: "receipt",
      ids: [uuid(1)],
      percent: 40,
    });
    expect(JSON.parse(chunk ?? "")).toEqual({
      householdId,
      type: "progress",
      entity: "receipt",
      ids: [uuid(1)],
      percent: 40,
    });
  });

  it("пустая пачка — ни одного сообщения", () => {
    expect(encodeSignal({ householdId, type: "changed", entity: "receipt", ids: [] })).toEqual([]);
  });

  it.each([
    ["id не uuid", { entity: "receipt", ids: ["42"] }],
    ["сущность не kebab-case", { entity: "Чек", ids: [uuid(1)] }],
    ["сущность длиннее 48", { entity: "a".repeat(49), ids: [uuid(1)] }],
  ])("%s — RangeError без значений", (_name, batch) => {
    expect(() => encodeSignal({ householdId, type: "changed", ...batch })).toThrow(RangeError);
    expect(() => encodeSignal({ householdId, type: "changed", ...batch })).not.toThrow(
      batch.ids[0] ?? "",
    );
  });
});

describe("ADR-0008: входящее сообщение канала проверяется схемой", () => {
  it("сообщение по схеме читается", () => {
    const message = { householdId, type: "changed", entity: "receipt", ids: [uuid(1)] };
    expect(decodeSignal(JSON.stringify(message))).toEqual(message);
  });

  it.each([
    ["не JSON", "{"],
    [
      "лишнее поле с данными",
      JSON.stringify({
        householdId,
        type: "changed",
        entity: "receipt",
        ids: [uuid(1)],
        amount: 100,
      }),
    ],
    ["без домохозяйства", JSON.stringify({ type: "changed", entity: "receipt", ids: [uuid(1)] })],
    [
      "неизвестный вид",
      JSON.stringify({ householdId, type: "deleted", entity: "receipt", ids: [uuid(1)] }),
    ],
    ["пустая пачка", JSON.stringify({ householdId, type: "changed", entity: "receipt", ids: [] })],
  ])("%s — undefined", (_name, payload) => {
    expect(decodeSignal(payload)).toBeUndefined();
  });
});
