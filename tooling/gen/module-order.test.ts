// ARCHITECTURE §3: корень композиции создаёт модули в порядке топологической сортировки modules.ts — каждый после
// всех своих зависимостей; при равенстве — порядок карты (детерминированно, без перестановок от запуска к запуску).
import { describe, expect, it } from "vitest";
import { MODULES, type ModuleDef } from "../architecture/modules.ts";
import { topologicalOrder } from "./module-order.ts";

function def(id: string, dependsOn: string[] = []): ModuleDef {
  return { id, tier: 1, spec: "—", responsibility: "—", dependsOn, tables: [], publishes: [] };
}

describe("topologicalOrder", () => {
  it("зависимость раньше зависящего, даже если в карте она ниже", () => {
    const order = topologicalOrder([def("b", ["a"]), def("a")]).map((m) => m.id);
    expect(order).toEqual(["a", "b"]);
  });

  it("независимые модули — в порядке карты", () => {
    expect(topologicalOrder([def("c"), def("a"), def("b")]).map((m) => m.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("цикл — ошибка с его модулями, а не бесконечный цикл", () => {
    expect(() => topologicalOrder([def("a", ["b"]), def("b", ["a"])])).toThrow(/a, b/);
  });

  it("зависимость, которой нет в карте, — ошибка", () => {
    expect(() => topologicalOrder([def("a", ["ghost"])])).toThrow(/ghost/);
  });

  it("на настоящей карте каждый из 36 модулей стоит после всех своих зависимостей", () => {
    const order = topologicalOrder(MODULES).map((m) => m.id);
    expect(order).toHaveLength(36);
    for (const m of MODULES) {
      for (const dep of m.dependsOn) expect(order.indexOf(dep)).toBeLessThan(order.indexOf(m.id));
    }
  });
});
