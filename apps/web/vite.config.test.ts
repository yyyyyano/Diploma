// @vitest-environment node
// Прокси и маршруты сборки сайта (T-008, T-059): Host доходит до сервера неизменным, витрина — не в боевой сборке.
import { describe, expect, it } from "vitest";
import { API_PROXY, API_TARGET, DEV_ROUTES_PATTERN, routerOptions } from "./vite.config.ts";

describe("прокси /api в разработке", () => {
  it("ведёт на локальный слушатель 127.0.0.1:8140", () => {
    expect(API_TARGET).toBe("http://127.0.0.1:8140");
    expect(API_PROXY["/api"]?.target).toBe(API_TARGET);
  });

  it("не меняет Host (без changeOrigin): иначе проверка CSRF и Host сервера даст 403", () => {
    expect(API_PROXY["/api"]?.changeOrigin).not.toBe(true);
  });
});

describe("витрина /dev/gallery", () => {
  it("в боевой сборке маршруты dev.* не попадают в дерево", () => {
    expect(routerOptions("production").routeFileIgnorePattern).toBe(DEV_ROUTES_PATTERN);
    expect(new RegExp(DEV_ROUTES_PATTERN).test("dev.gallery.tsx")).toBe(true);
  });

  it.each(["development", "e2e"])("в режиме %s витрина есть", (mode) => {
    expect(routerOptions(mode)).not.toHaveProperty("routeFileIgnorePattern");
  });
});
