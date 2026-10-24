// CHAT-08, ARCHITECTURE §10.2: контекст страницы для агента — маршрут, параметры адреса и выбранный объект. Это вход
// модели, поэтому всё ограничено по длине и количеству, лишние поля (в том числе «чьи данные») не проходят.
import { describe, expect, it } from "vitest";
import { PageContext } from "./page-context.ts";

const id = "0190f0a0-0000-7000-8000-000000000001";

describe("PageContext", () => {
  it("маршрут, параметры адреса и выбранная операция", () => {
    const context = {
      route: "/operations",
      params: { period: "2026-09", category: "taxi" },
      selected: { entity: "transaction", id },
    };
    expect(PageContext.parse(context)).toEqual(context);
  });

  it("без выбранного объекта", () => {
    expect(PageContext.parse({ route: "/", params: {} })).toEqual({ route: "/", params: {} });
  });

  it("маршрут — путь сайта, начинается с «/»", () => {
    expect(PageContext.safeParse({ route: "operations", params: {} }).success).toBe(false);
  });

  it("маршрут длиннее 200 символов не проходит", () => {
    expect(PageContext.safeParse({ route: `/${"a".repeat(200)}`, params: {} }).success).toBe(false);
  });

  it("значение параметра длиннее 200 символов не проходит", () => {
    expect(PageContext.safeParse({ route: "/", params: { q: "a".repeat(201) } }).success).toBe(
      false,
    );
  });

  it("больше 20 параметров не проходит", () => {
    const params = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}`, "x"]));
    expect(PageContext.safeParse({ route: "/", params }).success).toBe(false);
  });

  it("20 параметров проходят", () => {
    const params = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, "x"]));
    expect(PageContext.safeParse({ route: "/", params }).success).toBe(true);
  });

  it("лишнее поле не проходит: «чьи данные» берутся из сессии, а не из контекста", () => {
    expect(PageContext.safeParse({ route: "/", params: {}, owner: id }).success).toBe(false);
  });

  it("выбранный объект — только uuid", () => {
    expect(
      PageContext.safeParse({
        route: "/",
        params: {},
        selected: { entity: "transaction", id: "1" },
      }).success,
    ).toBe(false);
  });
});
