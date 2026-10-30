// Хэш расчёта (EXPL-02, ADR-0017): sha256 канонического JSON трассы и периода. Канонизация — ключи объектов по порядку
// и без `undefined`: одинаковый расчёт при любом порядке свойств даёт один хэш.
import { createHash } from "node:crypto";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function traceHash(
  trace: unknown,
  period: { from: string; to: string } | undefined,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical({ trace, period: period ?? null })))
    .digest("hex");
}
