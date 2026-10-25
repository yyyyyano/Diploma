// Описание модуля (ADR-0003, ADR-0004, ARCHITECTURE §3, §4.3, §5): фабрика create<Id>Module({ platform, facades })
// возвращает defineModule({ id, facade, router, jobs, … }) — всё, кроме id, необязательно. Корень композиции
// (main/compose.ts) создаёт модули по порядку modules.ts и раскладывает части по реестрам (main/registries.ts):
// роутеры, задачи, подписки, расписания, обходы, инструменты агента, каналы доставки, обработчики отмены и
// подтверждения, владельцы данных, настройки, секреты, правила частоты. Сами части описывают готовые помощники
// платформы (defineJob, defineEvent, defineTool…); здесь — только форма модуля и проверка имён.
import type { Clock, Scope } from "@kosht/kernel";
import type { BlobStore } from "../blob-store/blob-store.ts";
import type { ScopedDb } from "../db/scoped-db.ts";
import type { SystemDb } from "../db/system-db.ts";
import type { UserDataDef } from "../db/user-data.ts";
import type { EventDef } from "../events/define-event.ts";
import type { Events } from "../events/events.ts";
import type { SubscriptionDef } from "../events/define-subscription.ts";
import type { ModuleRouter } from "../http/procedures.ts";
import type { JobDef } from "../jobs/define-job.ts";
import type { Jobs } from "../jobs/jobs.ts";
import type { ScheduleDef } from "../jobs/schedule.ts";
import type { SweepDef } from "../jobs/sweep.ts";
import type { Logger } from "../logging/logger.ts";
import type { RateLimiter, RateRule } from "../rate-limit/rate-limit.ts";
import type { Realtime } from "../realtime/realtime.ts";
import type { SecretDef, Secrets } from "../secrets/secrets.ts";
import type { SettingDef, Settings } from "../settings/settings.ts";
import type { ToolDef } from "../tools/define-tool.ts";

/** Порты платформы, которые получает каждый модуль. */
export interface Platform {
  readonly clock: Clock;
  readonly log: Logger;
  readonly settings: Settings;
  readonly secrets: Secrets;
  readonly rateLimiter: RateLimiter;
  readonly blobs: BlobStore;
  readonly jobs: Jobs;
  readonly events: Events;
  readonly realtime: Realtime;
  /** ScopedDb для scope, рождённого на входе модуля (Telegram, ARCHITECTURE §6.4). */
  scoped(scope: Scope): ScopedDb;
}

/** Платформа модуля с таблицами system или public (признак systemTables в modules.ts, ARCHITECTURE §6.5). */
export interface SystemPlatform extends Platform {
  readonly system: SystemDb;
}

/** Фасады соседей модуля без зависимостей. */
export type NoFacades = Readonly<Record<string, never>>;

/** Вход фабрики модуля: платформа и фасады ровно тех модулей, что в его dependsOn (ключ — id в camelCase). */
export interface ModuleDeps<F extends object = NoFacades, P extends Platform = Platform> {
  readonly platform: P;
  readonly facades: F;
}

/** Обработчик отмены («Отменить», P5) или подтверждения («Да», AGT-07): нагрузку проверяет сам модуль. */
export type ActionHandler = (s: ScopedDb, payload: unknown) => Promise<void>;

/** Канал доставки уведомлений (web, telegram) для реестра notifications; форму дополнит T-015. */
export interface DeliveryChannel {
  readonly name: string;
  deliver(s: ScopedDb, notificationIds: readonly string[]): Promise<void>;
}

/** Части модуля для реестров. */
export interface ModuleParts {
  /** Ветка дерева процедур contract.<модуль>.* (пустая или её нет — допустимо). */
  readonly router?: ModuleRouter;
  readonly events?: readonly EventDef[];
  readonly jobs?: readonly JobDef[];
  readonly subscriptions?: readonly SubscriptionDef[];
  readonly schedules?: readonly ScheduleDef[];
  readonly sweeps?: readonly SweepDef[];
  readonly tools?: readonly ToolDef[];
  readonly deliveryChannels?: readonly DeliveryChannel[];
  readonly undo?: Readonly<Record<string, ActionHandler>>;
  readonly confirm?: Readonly<Record<string, ActionHandler>>;
  readonly userData?: UserDataDef;
  readonly settings?: readonly SettingDef<unknown>[];
  readonly secrets?: readonly SecretDef[];
  readonly rateRules?: readonly RateRule[];
}

/** Модуль после defineModule: все списки есть (пустые — тоже), реестры читают их без проверок. */
export interface ModuleDescriptor<F = unknown> {
  readonly id: string;
  /** Что модуль даёт соседям (узко, агрегаты — пачками); undefined — фасада пока нет. */
  readonly facade: F;
  readonly router: ModuleRouter | undefined;
  readonly events: readonly EventDef[];
  readonly jobs: readonly JobDef[];
  readonly subscriptions: readonly SubscriptionDef[];
  readonly schedules: readonly ScheduleDef[];
  readonly sweeps: readonly SweepDef[];
  readonly tools: readonly ToolDef[];
  readonly deliveryChannels: readonly DeliveryChannel[];
  readonly undo: Readonly<Record<string, ActionHandler>>;
  readonly confirm: Readonly<Record<string, ActionHandler>>;
  readonly userData: UserDataDef | undefined;
  readonly settings: readonly SettingDef<unknown>[];
  readonly secrets: readonly SecretDef[];
  readonly rateRules: readonly RateRule[];
}

/** id модуля — как в tooling/architecture/modules.ts. */
const MODULE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function defineModule(
  spec: ModuleParts & { readonly id: string },
): ModuleDescriptor<undefined>;
export function defineModule<F>(
  spec: ModuleParts & { readonly id: string; readonly facade: F },
): ModuleDescriptor<F>;
export function defineModule(
  spec: ModuleParts & { readonly id: string; readonly facade?: unknown },
): ModuleDescriptor {
  const { id } = spec;
  if (!MODULE_ID.test(id))
    throw new RangeError(`id модуля «${id}»: ожидается kebab-case латиницей.`);
  const module: ModuleDescriptor = {
    id,
    facade: spec.facade,
    router: spec.router,
    events: spec.events ?? [],
    jobs: spec.jobs ?? [],
    subscriptions: spec.subscriptions ?? [],
    schedules: spec.schedules ?? [],
    sweeps: spec.sweeps ?? [],
    tools: spec.tools ?? [],
    deliveryChannels: spec.deliveryChannels ?? [],
    undo: spec.undo ?? {},
    confirm: spec.confirm ?? {},
    userData: spec.userData,
    settings: spec.settings ?? [],
    secrets: spec.secrets ?? [],
    rateRules: spec.rateRules ?? [],
  };
  // id — префикс событий, задач и действий (docs/CAPABILITIES.md «Как читать»): по префиксу видно владельца.
  const owned = [
    ...module.events.map((e) => e.name),
    ...module.jobs.map((j) => j.name),
    ...module.schedules.map((s) => s.name),
    ...module.sweeps.map((s) => s.name),
    ...Object.keys(module.undo),
    ...Object.keys(module.confirm),
  ];
  const foreign = owned.find((name) => !name.startsWith(`${id}.`) || name.length <= id.length + 1);
  if (foreign !== undefined) {
    throw new RangeError(`Модуль ${id}: «${foreign}» — имя должно начинаться с «${id}.».`);
  }
  const subscription = module.subscriptions.find((s) => s.module !== id);
  if (subscription !== undefined) {
    throw new RangeError(
      `Модуль ${id}: подписка ${subscription.job.name} объявлена для модуля ${subscription.module}.`,
    );
  }
  return module;
}
