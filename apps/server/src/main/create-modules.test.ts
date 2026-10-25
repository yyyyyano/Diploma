// ARCHITECTURE §3, §13 шаг 5: все 36 модулей есть и собираются по карте modules.ts — порядок сборки
// топологический, каждый модуль получает фасады ровно своих dependsOn и SystemDb только при таблицах system/public;
// паспорт каждого модуля называет те же ярус и зависимости, что карта. Сверка — по тексту create-modules.ts
// (форматирование не важно) и паспортов; порядок при настоящем старте проверяет compose.int.test.ts.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODULES, systemTables } from "../../../../tooling/architecture/modules.ts";
import { camel } from "../../../../tooling/gen/module-files.ts";
import { topologicalOrder } from "../../../../tooling/gen/module-order.ts";

const wiring = readFileSync(new URL("./create-modules.ts", import.meta.url), "utf8");

/** Вызовы фабрик из create-modules.ts: переменная, платформа и ключи фасадов. */
const calls = [
  ...wiring.matchAll(
    /const (\w+)Module = create\w+Module\(\{\s*platform: ports\.(\w+),\s*facades: \{([^}]*)\},?\s*\}\);/g,
  ),
].map(([, key = "", platform = "", facades = ""]) => ({
  key,
  platform,
  // Фасад соседа передаётся под его же ключом: { mail: mailModule.facade }.
  facades: [...facades.matchAll(/(\w+): (\w+)Module\.facade/g)].map(([, name = "", source = ""]) =>
    name === source ? name : `${name} ← ${source}`,
  ),
}));

function moduleFile(id: string, file: string): URL {
  return new URL(`../modules/${id}/${file}`, import.meta.url);
}

describe("main/create-modules.ts по карте modules.ts", () => {
  it("все 36 модулей создаются в порядке топологической сортировки карты", () => {
    expect(calls.map((call) => call.key)).toEqual(
      topologicalOrder(MODULES).map((m) => camel(m.id)),
    );
  });

  it.each(MODULES.map((m) => [m.id, m] as const))(
    "%s получает фасады ровно своих dependsOn и SystemDb только при таблицах system/public",
    (id, m) => {
      const call = calls.find((candidate) => candidate.key === camel(id));
      expect(call).toEqual({
        key: camel(id),
        platform: systemTables(m) ? "systemPlatform" : "platform",
        facades: m.dependsOn.map(camel),
      });
    },
  );

  it("возвращает все созданные модули в том же порядке", () => {
    const returned = /return \[([^\]]*)\];/.exec(wiring)?.[1] ?? "";
    expect(
      returned
        .split(",")
        .map((item) => item.trim().replace(/Module$/, ""))
        .filter((item) => item !== ""),
    ).toEqual(calls.map((call) => call.key));
  });
});

describe("папка и паспорт каждого модуля", () => {
  it.each(MODULES.map((m) => [m.id, m] as const))(
    "%s: index.ts, module.ts с defineModule и паспорт ≤ 60 строк с ярусом и зависимостями карты",
    (id, m) => {
      expect(existsSync(moduleFile(id, "index.ts"))).toBe(true);
      expect(readFileSync(moduleFile(id, "module.ts"), "utf8")).toContain(
        `defineModule({ id: "${id}"`,
      );
      const passport = readFileSync(moduleFile(id, "CLAUDE.md"), "utf8");
      expect(passport.trimEnd().split("\n").length).toBeLessThanOrEqual(60);
      expect(/^Ярус (\d)/m.exec(passport)?.[1]).toBe(String(m.tier));
      const depends = /^Можно: (.*?) \(`tooling\/architecture\/modules\.ts`\)/m.exec(passport)?.[1];
      expect(depends === "—" ? [] : depends?.split(", ")).toEqual(m.dependsOn);
    },
  );
});
