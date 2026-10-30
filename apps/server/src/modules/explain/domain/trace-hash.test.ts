// EXPL-02: хэш расчёта не зависит от порядка свойств и пустых полей, но зависит от чисел и периода.
import { describe, expect, it } from "vitest";
import { traceHash } from "./trace-hash.ts";

describe("EXPL-02: хэш трассы", () => {
  const a = {
    key: "fin.freeBalance",
    op: "sub",
    value: { minor: 84_000, currency: "BYN" },
    inputs: [],
    refs: [],
  };

  it("порядок свойств и undefined не меняют хэш", () => {
    const b = {
      refs: [],
      inputs: [],
      value: { currency: "BYN", minor: 84_000 },
      op: "sub",
      key: "fin.freeBalance",
      note: undefined,
    };
    expect(traceHash(a, undefined)).toBe(traceHash(b, undefined));
  });

  it("другая сумма или другой период — другой хэш", () => {
    expect(traceHash(a, undefined)).not.toBe(
      traceHash({ ...a, value: { minor: 1, currency: "BYN" } }, undefined),
    );
    expect(traceHash(a, undefined)).not.toBe(
      traceHash(a, { from: "2026-07-01", to: "2026-09-30" }),
    );
  });

  it("порядок элементов массива важен: слагаемые идут по порядку формулы", () => {
    expect(traceHash({ inputs: [1, 2] }, undefined)).not.toBe(
      traceHash({ inputs: [2, 1] }, undefined),
    );
  });
});
