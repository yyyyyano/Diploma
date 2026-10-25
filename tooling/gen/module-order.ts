// Порядок сборки модулей (ARCHITECTURE §3): топологическая сортировка карты modules.ts — модуль создаётся после
// всех своих зависимостей, чтобы получить их фасады. При равенстве — порядок карты: порядок детерминирован, и
// корень композиции (main/create-modules.ts) не переставляется от запуска к запуску.
import type { ModuleDef } from "../architecture/modules.ts";

export function topologicalOrder(modules: readonly ModuleDef[]): ModuleDef[] {
  const known = new Set(modules.map((m) => m.id));
  for (const m of modules) {
    const missing = m.dependsOn.find((dep) => !known.has(dep));
    if (missing !== undefined)
      throw new Error(`Модуль ${m.id} зависит от неизвестного ${missing}.`);
  }
  const placed = new Set<string>();
  const order: ModuleDef[] = [];
  while (order.length < modules.length) {
    const next = modules.find((m) => !placed.has(m.id) && m.dependsOn.every((d) => placed.has(d)));
    if (next === undefined) {
      const rest = modules.filter((m) => !placed.has(m.id)).map((m) => m.id);
      throw new Error(`Цикл зависимостей среди модулей: ${rest.join(", ")}.`);
    }
    placed.add(next.id);
    order.push(next);
  }
  return order;
}
