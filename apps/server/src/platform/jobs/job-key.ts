// Ключ схлопывания задач (ADR-0008, .claude/rules/database.md): singletonKey строится только здесь и всегда начинается
// с домохозяйства scope. Ключ без scope («budgets.recheck») подавил бы задачу другого домохозяйства: очередь short
// держит одну ожидающую задачу на ключ.
import type { Scope } from "@kosht/kernel";

/** `<householdId>:<часть>:…` — `jobKey(scope, "budgets.recheck")`; без частей — `RangeError`. */
export function jobKey(scope: Scope, ...parts: readonly string[]): string {
  if (parts.length === 0 || parts.some((part) => part === "")) {
    throw new RangeError("jobKey: нужна хотя бы одна непустая часть ключа после scope.");
  }
  return [scope.householdId, ...parts].join(":");
}
