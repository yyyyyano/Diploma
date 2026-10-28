// Настройки системы (ARCHITECTURE §9, ADM-60): реестр defineSetting и чтение с приоритетом «админка > env >
// умолчание». Значение проверяется схемой настройки и при записи (неверное — VALIDATION), и при чтении (неверное в
// базе или в env — пропускается со строкой в логе, действует следующий источник). Кэш — не дольше 5 с по Clock:
// значение, заданное в админке другим процессом, видно не позже чем через 5 с.
// Часы settings берёт без пояса (только now): пояс сам — настройка (time-zone.ts), иначе получился бы цикл.
// Модули регистрируют свои настройки здесь же (помощник модуля в T-007 вызывает defineSetting, а не копирует его).
import type { Clock } from "@kosht/kernel";
import type { z } from "zod";
import type { EnvLookup } from "../config/config.ts";
import type { SystemDb } from "../db/system-db.ts";
import { AppError } from "../errors/app-error.ts";
import type { Logger } from "../logging/logger.ts";
import { deleteStored, readStored, writeStored } from "./settings.repo.ts";

/** Ключ настройки — как ключ события: `clock.time-zone`. */
const SETTING_KEY = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** Не дольше этого значение берётся из кэша (ARCHITECTURE §9). */
export const SETTINGS_CACHE_MS = 5_000;

export interface SettingDef<T> {
  readonly key: string;
  readonly schema: z.ZodType<T>;
  readonly default: T;
  /** Переменная окружения разработчика (NFR-16: значение из админки важнее). */
  readonly env?: string;
  /** Строка env → значение для схемы (число, флаг); по умолчанию — сама строка. */
  readonly fromEnv?: (raw: string) => unknown;
}

/** Откуда взято значение: админка, окружение или умолчание. */
export type SettingSource = "admin" | "env" | "default";

const registry = new Map<string, SettingDef<unknown>>();

/** Зарегистрировать настройку; ключ уникален, умолчание обязано пройти схему. */
export function defineSetting<T>(def: SettingDef<T>): SettingDef<T> {
  if (!SETTING_KEY.test(def.key)) {
    throw new RangeError(`Ключ настройки «${def.key}»: ожидается вида clock.time-zone.`);
  }
  if (def.env !== undefined && !ENV_NAME.test(def.env)) {
    throw new RangeError(`Переменная настройки ${def.key}: только A–Z, 0–9 и _.`);
  }
  if (registry.has(def.key)) throw new Error(`Настройка ${def.key} объявлена дважды.`);
  if (!def.schema.safeParse(def.default).success) {
    throw new RangeError(`Умолчание настройки ${def.key} не проходит её схему.`);
  }
  registry.set(def.key, def as SettingDef<unknown>);
  return def;
}

/** Все зарегистрированные настройки (экран «Система» в админке). */
export function registeredSettings(): readonly SettingDef<unknown>[] {
  return [...registry.values()];
}

export interface Settings {
  /** Значение по приоритету «админка > env > умолчание»; кэш ≤ 5 с. */
  get<T>(def: SettingDef<T>): Promise<T>;
  /** То же синхронно — для часов: последнее известное значение (или env/умолчание), устаревшее обновляется в фоне. */
  peek<T>(def: SettingDef<T>): T;
  /** Откуда сейчас берётся значение (админка показывает «задано здесь / в .env / по умолчанию»). */
  source(def: SettingDef<unknown>): Promise<SettingSource>;
  /** Задать в админке; не проходит схему — AppError VALIDATION. */
  set<T>(def: SettingDef<T>, value: unknown): Promise<void>;
  /** Убрать значение админки: снова действуют env и умолчание. */
  reset(def: SettingDef<unknown>): Promise<void>;
}

export interface SettingsDeps {
  readonly db: SystemDb;
  readonly clock: Pick<Clock, "now">;
  readonly env: EnvLookup;
  readonly log: Logger;
}

interface Resolved {
  readonly value: unknown;
  readonly source: SettingSource;
}

export function createSettings(deps: SettingsDeps): Settings {
  const cache = new Map<string, { readonly resolved: Resolved; readonly at: number }>();
  const inflight = new Map<string, Promise<Resolved>>();
  // Растёт при каждой записи: загрузка, начатая до set/reset, не кладёт в кэш старое значение.
  let generation = 0;

  function fromEnv(def: SettingDef<unknown>): Resolved | undefined {
    const raw = def.env === undefined ? undefined : deps.env(def.env);
    if (raw === undefined) return undefined;
    const parsed = def.schema.safeParse((def.fromEnv ?? ((text: string) => text))(raw));
    if (parsed.success) return { value: parsed.data, source: "env" };
    deps.log.warn({ setting: def.key }, "settings.env-invalid");
    return undefined;
  }

  function fallback(def: SettingDef<unknown>): Resolved {
    return fromEnv(def) ?? { value: def.default, source: "default" };
  }

  async function load(def: SettingDef<unknown>): Promise<Resolved> {
    const started = generation;
    const stored = await readStored(deps.db, def.key);
    let resolved: Resolved | undefined;
    if (stored !== undefined) {
      const parsed = def.schema.safeParse(stored.value);
      if (parsed.success) resolved = { value: parsed.data, source: "admin" };
      else deps.log.warn({ setting: def.key }, "settings.stored-invalid");
    }
    resolved ??= fallback(def);
    if (started === generation) cache.set(def.key, { resolved, at: deps.clock.now().getTime() });
    return resolved;
  }

  async function resolve(def: SettingDef<unknown>): Promise<Resolved> {
    const cached = cache.get(def.key);
    if (cached !== undefined && deps.clock.now().getTime() - cached.at < SETTINGS_CACHE_MS) {
      return cached.resolved;
    }
    const running = inflight.get(def.key);
    if (running !== undefined) return running;
    const loading = load(def).finally(() => inflight.delete(def.key));
    inflight.set(def.key, loading);
    return loading;
  }

  function forget(key: string): void {
    generation += 1;
    cache.delete(key);
    inflight.delete(key);
  }

  return {
    async get<T>(def: SettingDef<T>): Promise<T> {
      // Значение прошло схему def при загрузке; тип T — тип этой схемы.
      return (await resolve(def as SettingDef<unknown>)).value as T;
    },
    peek<T>(def: SettingDef<T>): T {
      const key = def as SettingDef<unknown>;
      const cached = cache.get(def.key);
      if (cached === undefined || deps.clock.now().getTime() - cached.at >= SETTINGS_CACHE_MS) {
        resolve(key).catch((error: unknown) => {
          deps.log.warn({ setting: def.key, err: error }, "settings.refresh-failed");
        });
      }
      return (cached?.resolved ?? fallback(key)).value as T;
    },
    async source(def) {
      return (await resolve(def)).source;
    },
    async set<T>(def: SettingDef<T>, value: unknown): Promise<void> {
      const parsed = def.schema.safeParse(value);
      if (!parsed.success) throw new AppError("VALIDATION", { setting: def.key });
      await writeStored(deps.db, def.key, parsed.data, deps.clock.now());
      forget(def.key);
      deps.log.info({ setting: def.key }, "settings.changed");
    },
    async reset(def) {
      await deleteStored(deps.db, def.key);
      forget(def.key);
      deps.log.info({ setting: def.key }, "settings.reset");
    },
  };
}
