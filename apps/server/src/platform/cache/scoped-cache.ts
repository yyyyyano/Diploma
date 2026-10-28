// Кэш пользовательских данных (ARCHITECTURE §6.6, LLM-05): ключ всегда начинается с householdId из s.scope — один
// домохозяйство не прочитает запись другого, даже с тем же ключом. В памяти процесса, с пределом записей (вытесняется
// самая давняя по использованию) и сроком жизни по часам (Clock, не Date.now). Опцию cache Drizzle не используем.
import type { Clock } from "@kosht/kernel";
import type { ScopedDb } from "../db/scoped-db.ts";

export interface ScopedCacheOptions {
  readonly max: number;
  readonly ttlMs: number;
  readonly clock: Pick<Clock, "now">;
}

export interface CacheView<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
}

/** Кэш на процесс; доступ — только через scopedCache(s): ключ — домохозяйство s и ключ вызывающего. */
export function createScopedCache<V>(options: ScopedCacheOptions) {
  const entries = new Map<string, { value: V; expires: number }>();
  return function scopedCache(s: Pick<ScopedDb, "scope">): CacheView<V> {
    const prefix = `${s.scope.householdId}:`;
    return {
      get(key) {
        const full = prefix + key;
        const entry = entries.get(full);
        if (entry === undefined) return undefined;
        if (entry.expires <= options.clock.now().getTime()) {
          entries.delete(full);
          return undefined;
        }
        // Обновить порядок: последняя использованная — в конце.
        entries.delete(full);
        entries.set(full, entry);
        return entry.value;
      },
      set(key, value) {
        const full = prefix + key;
        entries.delete(full);
        entries.set(full, { value, expires: options.clock.now().getTime() + options.ttlMs });
        while (entries.size > options.max) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) break;
          entries.delete(oldest);
        }
      },
    };
  };
}

export type ScopedCache<V> = ReturnType<typeof createScopedCache<V>>;
