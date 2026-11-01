// TG-02: код привязки — 256 бит, в базе только хэш, из текста «/start» принимается только настоящая форма кода.
import { describe, expect, it } from "vitest";
import { codeFromStart, deepLink, hashLinkCode, newLinkCode } from "./link-code.ts";

describe("TG-02: код привязки", () => {
  it("код — 43 знака base64url (256 бит), каждый раз новый", () => {
    const codes = new Set(Array.from({ length: 50 }, () => newLinkCode()));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("хэш — SHA-256 в hex и не равен коду", () => {
    const code = newLinkCode();
    expect(hashLinkCode(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkCode(code)).not.toContain(code);
    expect(hashLinkCode(code)).toBe(hashLinkCode(code));
  });

  it("из «/start» берётся только настоящая форма кода", () => {
    const code = newLinkCode();
    expect(codeFromStart(` ${code} `)).toBe(code);
    expect(codeFromStart("")).toBeUndefined();
    expect(codeFromStart("короткий")).toBeUndefined();
    expect(codeFromStart(`${code}x`)).toBeUndefined();
    expect(codeFromStart("a'; drop table telegram_links; --".padEnd(43, "a"))).toBeUndefined();
  });

  it("ссылка ведёт на бота и несёт код", () => {
    expect(deepLink("kosht_bot", "abc")).toBe("https://t.me/kosht_bot?start=abc");
  });
});
