import { describe, expect, it } from "vitest";
import { MasterKey } from "./master-key.ts";

describe("NFR-16: мастер-ключ и выведенные ключи", () => {
  const key = MasterKey.fromBytes(Buffer.alloc(32, 1));

  it("ключи разных назначений различаются и повторяемы", () => {
    const secrets = key.derive("secrets/v1");
    expect(secrets).toHaveLength(32);
    expect(secrets.equals(key.derive("secrets/v1"))).toBe(true);
    expect(secrets.equals(key.derive("rate-limit/v1"))).toBe(false);
  });

  it("другой мастер-ключ — другой выведенный ключ", () => {
    const other = MasterKey.fromBytes(Buffer.alloc(32, 2));
    expect(other.derive("secrets/v1").equals(key.derive("secrets/v1"))).toBe(false);
  });

  it("не 32 байта — RangeError без содержимого", () => {
    expect(() => MasterKey.fromBytes(Buffer.alloc(31, 9))).toThrow(
      "ожидается ровно 32 байта, получено 31",
    );
  });

  it("правка исходного буфера не меняет ключ", () => {
    const bytes = Buffer.alloc(32, 3);
    const copy = MasterKey.fromBytes(bytes);
    const before = copy.derive("secrets/v1");
    bytes.fill(4);
    expect(copy.derive("secrets/v1").equals(before)).toBe(true);
  });
});
