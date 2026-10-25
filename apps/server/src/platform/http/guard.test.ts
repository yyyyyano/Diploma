import { describe, expect, it } from "vitest";
import { hostName, isAllowedHost, isSameSiteRequest, requestIdFrom } from "./guard.ts";

describe("NFR-24, ADR-0016: Host против DNS-rebinding", () => {
  it.each(["localhost", "localhost:8140", "127.0.0.1:8140", "[::1]:8140", "LOCALHOST:5173"])(
    "локальный слушатель принимает имя этого компьютера «%s»",
    (host) => {
      expect(isAllowedHost(host, "local")).toBe(true);
    },
  );

  it.each(["192.168.1.5:8140", "evil.example:8140", "localhost.evil.example", "[fe80::1]:8140"])(
    "локальный слушатель отвергает «%s»",
    (host) => {
      expect(isAllowedHost(host, "local")).toBe(false);
    },
  );

  it.each(["localhost:8141", "127.0.0.1:8141", "[::1]:8141", "192.168.1.5:8141", "[fd00::5]:8141"])(
    "сетевой слушатель принимает имя этого компьютера и IP-адрес «%s»",
    (host) => {
      expect(isAllowedHost(host, "lan")).toBe(true);
    },
  );

  it.each([
    "kosht.home:8141",
    "evil.example",
    "192.168.1.5.nip.io:8141",
    "1.2.3:8141",
    "[not-ip]:8141",
    "",
    undefined,
  ])("сетевой слушатель отвергает имя и неразборчивый Host «%s»", (host) => {
    expect(isAllowedHost(host, "lan")).toBe(false);
  });

  it("имя хоста — без порта и в нижнем регистре", () => {
    expect(hostName("LocalHost:8140")).toBe("localhost");
    expect(hostName("[::1]:8140")).toBe("[::1]");
    expect(hostName("a:b:c")).toBeUndefined();
  });
});

describe("SEC-01: CSRF — Sec-Fetch-Site и Origin у изменяющих запросов", () => {
  const base = {
    method: "POST",
    host: "127.0.0.1:5173",
    origin: undefined,
    secFetchSite: undefined,
    trustedOrigins: [],
  } as const;

  it("запрос со своей страницы через прокси Vite (Origin = Host с портом) проходит", () => {
    expect(
      isSameSiteRequest({ ...base, origin: "http://127.0.0.1:5173", secFetchSite: "same-origin" }),
    ).toBe(true);
  });

  it.each(["cross-site", "same-site"])("Sec-Fetch-Site: %s → отказ", (site) => {
    expect(isSameSiteRequest({ ...base, secFetchSite: site })).toBe(false);
  });

  it("TRUSTED_ORIGINS не отменяет Sec-Fetch-Site: cross-site", () => {
    expect(
      isSameSiteRequest({
        ...base,
        origin: "http://tablet.home",
        secFetchSite: "cross-site",
        trustedOrigins: ["http://tablet.home"],
      }),
    ).toBe(false);
  });

  it("чужой Origin → отказ, тот же Origin из TRUSTED_ORIGINS → проходит", () => {
    expect(isSameSiteRequest({ ...base, origin: "http://evil.example" })).toBe(false);
    expect(
      isSameSiteRequest({
        ...base,
        origin: "http://tablet.home",
        trustedOrigins: ["http://tablet.home"],
      }),
    ).toBe(true);
  });

  it("Origin с другим портом или схемой — чужой", () => {
    expect(isSameSiteRequest({ ...base, origin: "http://127.0.0.1:8140" })).toBe(false);
    expect(isSameSiteRequest({ ...base, origin: "https://127.0.0.1:5173" })).toBe(false);
    expect(isSameSiteRequest({ ...base, origin: "null" })).toBe(false);
  });

  it("оба заголовка пусты — не браузер (curl, тесты): проходит", () => {
    expect(isSameSiteRequest(base)).toBe(true);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("%s не проверяется: он ничего не меняет", (method) => {
    expect(
      isSameSiteRequest({
        ...base,
        method,
        origin: "http://evil.example",
        secFetchSite: "cross-site",
      }),
    ).toBe(true);
  });

  it.each(["PUT", "PATCH", "DELETE"])("%s проверяется так же, как POST", (method) => {
    expect(isSameSiteRequest({ ...base, method, origin: "http://evil.example" })).toBe(false);
  });
});

describe("OBS-01: request-id клиента — только по шаблону", () => {
  it("id по шаблону [A-Za-z0-9-]{8,64} принимается как есть", () => {
    expect(requestIdFrom("abcDEF12-3456")).toBe("abcDEF12-3456");
  });

  it.each(["short", "a".repeat(65), "id with spaces", "ivan@mail.by-12345", "x\ny-12345678"])(
    "«%s» заменяется новым id",
    (header) => {
      const id = requestIdFrom(header);
      expect(id).not.toBe(header);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it("без заголовка — новый id", () => {
    expect(requestIdFrom(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
