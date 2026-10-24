// Карта модулей (ADR-0003, docs/CAPABILITIES.md): 36 модулей, зависимости только вниз и без циклов —
// на этих свойствах держатся генерируемые правила границ и порядок сборки в корне композиции.
import { describe, expect, it } from "vitest";
import { MODULES, systemTables, userData, type ModuleDef } from "./modules.ts";

const byId = new Map(MODULES.map((m) => [m.id, m]));

function moduleOf(id: string): ModuleDef {
  const found = byId.get(id);
  if (found === undefined) throw new Error(`нет модуля ${id}`);
  return found;
}

// Поиск цикла обходом в глубину: возвращает цепочку id, замыкающую цикл, или null.
function findCycle(modules: readonly ModuleDef[]): string[] | null {
  const deps = new Map(modules.map((m) => [m.id, m.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];
  function visit(id: string): string[] | null {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    path.push(id);
    for (const dep of deps.get(id) ?? []) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, "done");
    return null;
  }
  for (const m of modules) {
    const cycle = visit(m.id);
    if (cycle) return cycle;
  }
  return null;
}

describe("modules.ts — карта модулей", () => {
  it("ровно 36 модулей с уникальными id", () => {
    expect(MODULES).toHaveLength(36);
    expect(byId.size).toBe(36);
  });

  it("каждый id — kebab-case", () => {
    const bad = MODULES.map((m) => m.id).filter((id) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id));
    expect(bad).toEqual([]);
  });

  it("ярус каждого модуля — от 1 до 4", () => {
    expect(MODULES.filter((m) => ![1, 2, 3, 4].includes(m.tier))).toEqual([]);
  });

  it("зависимости существуют, не повторяются и не указывают на сам модуль", () => {
    const problems = MODULES.flatMap((m) => [
      ...m.dependsOn.filter((d) => !byId.has(d)).map((d) => `${m.id} → ${d}: нет такого модуля`),
      ...m.dependsOn.filter((d) => d === m.id).map((d) => `${m.id} → ${d}: зависимость от себя`),
      ...(new Set(m.dependsOn).size === m.dependsOn.length ? [] : [`${m.id}: повтор в dependsOn`]),
    ]);
    expect(problems).toEqual([]);
  });

  it("зависимости — только от модулей своего или нижнего яруса", () => {
    const upward = MODULES.flatMap((m) =>
      m.dependsOn
        .filter((d) => moduleOf(d).tier > m.tier)
        .map((d) => `${m.id} (ярус ${m.tier}) → ${d} (ярус ${moduleOf(d).tier})`),
    );
    expect(upward).toEqual([]);
  });

  it("в графе зависимостей нет циклов", () => {
    expect(findCycle(MODULES)).toBeNull();
  });

  it("поиск цикла сам находит цикл — иначе проверка выше ничего не стоит", () => {
    const looped: ModuleDef[] = [
      { ...moduleOf("files"), dependsOn: ["explain"] },
      { ...moduleOf("explain"), dependsOn: ["files"] },
    ];
    expect(findCycle(looped)).toEqual(["files", "explain", "files"]);
  });

  it("виды таблиц — только user, system, public, без повторов", () => {
    const bad = MODULES.filter(
      (m) =>
        m.tables.some((t) => !["user", "system", "public"].includes(t)) ||
        new Set(m.tables).size !== m.tables.length,
    ).map((m) => m.id);
    expect(bad).toEqual([]);
  });

  it("событие модуля начинается с его id", () => {
    const bad = MODULES.flatMap((m) =>
      m.publishes.filter((e) => !e.startsWith(`${m.id}.`)).map((e) => `${m.id}: ${e}`),
    );
    expect(bad).toEqual([]);
  });
});

describe("userData и systemTables выводятся из tables", () => {
  it("модуль с таблицами user — userData, без system/public — без SystemDb (files)", () => {
    expect([userData(moduleOf("files")), systemTables(moduleOf("files"))]).toEqual([true, false]);
  });

  it("модуль только с system — SystemDb без пользовательских данных (mail)", () => {
    expect([userData(moduleOf("mail")), systemTables(moduleOf("mail"))]).toEqual([false, true]);
  });

  it("публичные таблицы тоже дают SystemDb — писать в них может только владелец (fx-rates)", () => {
    expect([userData(moduleOf("fx-rates")), systemTables(moduleOf("fx-rates"))]).toEqual([
      false,
      true,
    ]);
  });

  it("модуль без таблиц не получает ни того, ни другого (admin — PRIV-07)", () => {
    expect([userData(moduleOf("admin")), systemTables(moduleOf("admin"))]).toEqual([false, false]);
  });
});
