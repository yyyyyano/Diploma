// DES-15: меню строится из staticData.nav маршрутов — проверяется на тестовом наборе маршрутов настоящего роутера.
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { ArrowLeftRight, LayoutGrid, Scale, Shield, Wallet } from "lucide-react";
import { describe, expect, it } from "vitest";
import { buildNav, isNavActive } from "./nav.ts";

function testRoutes() {
  const root = createRootRoute();
  const route = (path: string, staticData?: object) =>
    createRoute({ getParentRoute: () => root, path, ...(staticData ? { staticData } : {}) });
  const tree = root.addChildren([
    route("/laws", { nav: { group: "law", order: 30, section: "laws", icon: Scale } }),
    route("/accounts", { nav: { group: "money", order: 30, section: "accounts", icon: Wallet } }),
    route("/", {
      nav: { group: "main", order: 10, section: "dashboard", icon: LayoutGrid, phoneTab: true },
    }),
    route("/operations", {
      nav: {
        group: "money",
        order: 10,
        section: "operations",
        icon: ArrowLeftRight,
        phoneTab: true,
      },
    }),
    route("/admin", {
      nav: { group: "profile", order: 90, section: "admin", icon: Shield, role: "admin" },
    }),
    route("/login"),
  ]);
  return Object.values(
    createRouter({ routeTree: tree, history: createMemoryHistory() }).routesById,
  );
}

describe("DES-15: меню из реестра маршрутов", () => {
  it("группы в порядке DES-15, пункты по order; маршрут без nav в меню не попадает", () => {
    const nav = buildNav(testRoutes(), "user");
    expect(nav.map((g) => [g.group, g.items.map((i) => i.href)])).toEqual([
      ["main", ["/"]],
      ["money", ["/operations", "/accounts"]],
      ["law", ["/laws"]],
    ]);
  });

  it("пункты ещё не готовых фич скрыты: нет маршрута — нет пункта и пустой группы", () => {
    const nav = buildNav(testRoutes(), "user");
    const sections = nav.flatMap((g) => g.items.map((i) => i.section));
    expect(sections).not.toContain("assistant");
    expect(sections).not.toContain("calendar");
    expect(nav.map((g) => g.group)).not.toContain("profile");
  });

  it("«Администрирование» — только администратору", () => {
    const nav = buildNav(testRoutes(), "admin");
    expect(nav.at(-1)).toMatchObject({ group: "profile", items: [{ href: "/admin" }] });
  });

  it("пункты нижней панели телефона помечены phoneTab", () => {
    const tabs = buildNav(testRoutes(), "user").flatMap((g) => g.items.filter((i) => i.phoneTab));
    expect(tabs.map((i) => i.section)).toEqual(["dashboard", "operations"]);
  });

  it("без маршрутов с nav меню пустое", () => {
    expect(buildNav([], undefined)).toEqual([]);
  });
});

describe("подсветка текущего раздела", () => {
  it.each([
    ["/operations", "/operations", true],
    ["/operations", "/operations/123", true],
    ["/operations", "/operations-archive", false],
    ["/", "/", true],
    ["/", "/operations", false],
  ])("%s на странице %s — %s", (href, pathname, active) => {
    expect(isNavActive(href, pathname)).toBe(active);
  });
});
