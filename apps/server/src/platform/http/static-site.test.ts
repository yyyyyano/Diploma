import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { createApp } from "./app.ts";
import { SECURITY_HEADERS } from "./guard.ts";
import { siteResponse } from "./static-site.ts";

const ROOT = fileURLToPath(new URL("./__fixtures__/site-root/", import.meta.url));

async function text(path: string): Promise<string | undefined> {
  const response = await siteResponse(ROOT, path);
  return response === undefined ? undefined : await response.text();
}

function site(root = ROOT) {
  const app = createApp({
    listener: "local",
    trustedOrigins: [],
    log: memoryLogger().log,
    ready: async () => {},
    webDistDir: root,
  });
  return (path: string, method = "GET") =>
    app.fetch(
      new Request(`http://127.0.0.1:8140${path}`, { method, headers: { host: "127.0.0.1:8140" } }),
    );
}

describe("статика сайта и SPA-fallback", () => {
  it("файл сборки отдаётся с типом по расширению и вечным кэшем", async () => {
    const response = await siteResponse(ROOT, "/assets/app.js");
    expect(response?.headers.get("content-type")).toContain("javascript");
    expect(response?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await response?.text()).toContain("site-root fixture");
  });

  it.each([
    "/",
    "/operations",
    "/settings/profile/",
    "/receipts/0192f5a0-0000-7000-8000-000000000001",
  ])("маршрут сайта «%s» — index.html без кэша", async (path) => {
    const response = await siteResponse(ROOT, path);
    expect(response?.headers.get("content-type")).toContain("text/html");
    expect(response?.headers.get("cache-control")).toBe("no-cache");
    expect(await response?.text()).toContain("site-root fixture");
  });

  it("отсутствующий файл с расширением — 404, а не index.html", async () => {
    expect(await siteResponse(ROOT, "/assets/missing.js")).toBeUndefined();
    expect(await siteResponse(ROOT, "/favicon.ico")).toBeUndefined();
  });

  it("/api и /api/… статика не обслуживает", async () => {
    expect(await siteResponse(ROOT, "/api")).toBeUndefined();
    expect(await siteResponse(ROOT, "/api/unknown")).toBeUndefined();
  });

  it("нет собранного сайта — нет и fallback", async () => {
    expect(await siteResponse("/nonexistent/kosht-web-dist", "/operations")).toBeUndefined();
  });
});

describe("SEC-03: обход пути в статике", () => {
  it.each([
    "/..%2foutside.txt",
    "/%2e%2e/outside.txt",
    "/assets/%2e%2e/%2e%2e/outside.txt",
    "/..%5coutside.txt",
    "/assets%5c..%5c..%5coutside.txt",
    "/index.html%00.js",
    "/%00",
    "/.hidden",
    "/%2ehidden",
    "/escape.txt",
    "/assets//app.js",
    "/%E0%A4%A",
  ])("«%s» не отдаёт ничего за пределами корня, dotfiles и битые пути", async (path) => {
    const body = await text(path);
    expect(body ?? "").not.toContain("OUTSIDE-SECRET");
    expect(body ?? "").not.toContain("HIDDEN-FIXTURE");
    expect(body).toBeUndefined();
  });

  it("ссылка внутри корня, ведущая наружу, не отдаётся (realpath)", async () => {
    expect(await siteResponse(ROOT, "/escape.txt")).toBeUndefined();
  });
});

describe("статика через приложение", () => {
  it("GET страницы — 200 с заголовками безопасности", async () => {
    const response = await site()("/operations");
    expect(response.status).toBe(200);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it("HEAD страницы — 200 без тела", async () => {
    const response = await site()("/operations", "HEAD");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("POST на маршрут сайта — 404: fallback только для GET и HEAD", async () => {
    const response = await site()("/operations", "POST");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("попытка обхода пути — 404 в общей форме ошибки", async () => {
    const response = await site()("/..%2f..%2fpackage.json");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});
