// Описание модуля (ADR-0003, ADR-0004, ARCHITECTURE §3, §4.3, §5): фабрика create<Id>Module({ platform, facades })
// возвращает defineModule({ id, facade, router, jobs, … }) — всё, кроме id, необязательно. Корень композиции
// (main/compose.ts) создаёт модули по порядку modules.ts и раскладывает части по реестрам (main/registries.ts):
// роутеры, задачи, подписки, расписания, обходы, инструменты агента, каналы доставки, обработчики отмены и
// подтверждения, владельцы данных, настройки, секреты, правила частоты. Сами части описывают готовые помощники
// платформы (defineJob, defineEvent, defineTool…); здесь — только форма модуля и проверка имён.
import type { Clock, Scope } from "@kosht/kernel";
import type { BlobStore } from "../blob-store/blob-store.ts";
import type { ModuleKeyPurpose } from "../config/master-key.ts";
import type { ScopedDb } from "../db/scoped-db.ts";
import type { SystemDb } from "../db/system-db.ts";
import type { UserDataDef, UserDataOwner } from "../db/user-data.ts";
import type { EventDef } from "../events/define-event.ts";
import type { Events } from "../events/events.ts";
import type { SubscriptionDef } from "../events/define-subscription.ts";
import type { ModuleRouter } from "../http/procedures.ts";
import type { SessionResolver } from "../http/session.ts";
import type { JobDef } from "../jobs/define-job.ts";
import type { Jobs } from "../jobs/jobs.ts";
import type { ScopeVerifier } from "../jobs/scope-verifier.ts";
import type { ScheduleDef } from "../jobs/schedule.ts";
import type { SweepDef } from "../jobs/sweep.ts";
import type { Logger } from "../logging/logger.ts";
import type { RateLimiter, RateRule } from "../rate-limit/rate-limit.ts";
import type { Realtime } from "../realtime/realtime.ts";
import type { SecretDef, Secrets } from "../secrets/secrets.ts";
import type { SettingDef, Settings } from "../settings/settings.ts";
import type { Telemetry } from "../telemetry/telemetry.ts";
import type { ToolDef } from "../tools/define-tool.ts";
import type { ConsentRegistry, ConsentSource } from "./consent-source.ts";
import type { KnownNamesRegistry, KnownNamesSource } from "./known-names.ts";

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
  /** Опции трасс ИИ (OBS-03): по умолчанию выключены, Langfuse — T-011. */
  readonly telemetry: Telemetry;
  /** Облачное согласие пользователя (PRIV-02): источник даёт модуль согласий; нет его — облако запрещено. */
  readonly consent: Pick<ConsentRegistry, "cloudAllowed">;
  /** Словарь имён пользователя для маскирования (PRIV-03): источник даёт модуль profile; нет его — пусто. */
  readonly knownNames: Pick<KnownNamesRegistry, "names">;
  /**
   * Инструменты агента всех модулей (реестр корня композиции, ADR-0009): агент не импортирует предметные модули.
   * Доступны после сборки модулей — вызов из фабрики модуля — ошибка.
   */
  tools(): readonly ToolDef[];
  /**
   * Обработчики «Отменить» и «Да» всех модулей (реестры undo/confirm корня композиции, ARCHITECTURE §5): actions
   * исполняет их по имени. Доступны после сборки модулей — вызов из фабрики модуля — ошибка.
   */
  actionHandlers(): ActionHandlers;
  /**
   * Каналы доставки уведомлений всех модулей (web — notifications, telegram — T-053), по имени: notifications доставляет
   * через них, не зная модулей-владельцев. Доступны после сборки модулей — вызов из фабрики модуля — ошибка.
   */
  deliveryChannels(): ReadonlyMap<string, DeliveryChannel>;
  /**
   * Владельцы данных всех модулей (PRIV-05/06) в порядке modules.ts: privacy выгружает и удаляет данные аккаунта, не
   * зная модулей-владельцев (удаляет — в обратном порядке). Доступны после сборки модулей — вызов из фабрики — ошибка.
   */
  userData(): readonly UserDataOwner[];
  /** ScopedDb для scope, рождённого на входе модуля (Telegram, ARCHITECTURE §6.4). */
  scoped(scope: Scope): ScopedDb;
}

/** Платформа модуля с таблицами system или public (признак systemTables в modules.ts, ARCHITECTURE §6.5). */
export interface SystemPlatform extends Platform {
  readonly system: SystemDb;
  /** Ключ назначения модуля из мастер-ключа (HKDF): подпись cookie сессии identity (ADR-0016). */
  deriveKey(purpose: ModuleKeyPurpose): Buffer;
  /** Адрес локального входа (`http://127.0.0.1:8140`): ссылки в письмах и Better Auth (NFR-24). */
  readonly localOrigin: string;
  /** Папка локальных моделей (`<DATA_DIR>/models`, NFR-25): сюда скачивает загрузчик llm, отсюда читают llama и whisper. */
  readonly modelsDir: string;
}

/** Фасады соседей модуля без зависимостей. */
export type NoFacades = Readonly<Record<string, never>>;

/** Вход фабрики модуля: платформа и фасады ровно тех модулей, что в его dependsOn (ключ — id в camelCase). */
export interface ModuleDeps<F extends object = NoFacades, P extends Platform = Platform> {
  readonly platform: P;
  readonly facades: F;
}

/**
 * Обработчик отмены («Отменить», P5) или подтверждения («Да», AGT-07): нагрузку проверяет сам модуль. Обработчик «Да»
 * может вернуть undoToken своего действия (удаление операций — «Отменить» сразу после, TXN-03).
 */
export type ActionHandler = (s: ScopedDb, payload: unknown) => Promise<string | undefined | void>;

/** Реестры обработчиков действий по имени `<модуль>.<действие>`. */
export interface ActionHandlers {
  readonly undo: ReadonlyMap<string, ActionHandler>;
  readonly confirm: ReadonlyMap<string, ActionHandler>;
}

/** Канал доставки уведомлений (web, telegram): получает id новых уведомлений вида, включённого в этом канале. */
export interface DeliveryChannel {
  /** Имя канала в настройках пользователя: `web`, `telegram`. */
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
  /** Источник сессий сайта — один на процесс, его даёт модуль входа (identity, ARCHITECTURE §6.4). */
  readonly sessionSource?: SessionResolver;
  /** Перепроверка владельца задачи — одна на процесс, её даёт модуль входа (identity). */
  readonly scopeVerifier?: ScopeVerifier;
  /** Источник облачного согласия (PRIV-02) — один на процесс, его даёт модуль согласий. */
  readonly consentSource?: ConsentSource;
  /** Источник имён пользователя для маскирования (PRIV-03) — один на процесс, его даёт модуль profile. */
  readonly knownNamesSource?: KnownNamesSource;
  /**
   * Остановка процесса (SIGTERM): довести или прервать свою работу в памяти (запуски агента) до закрытия очереди и
   * пула. Корень композиции зовёт её первой при close().
   */
  readonly stop?: () => Promise<void>;
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
  readonly sessionSource: SessionResolver | undefined;
  readonly scopeVerifier: ScopeVerifier | undefined;
  readonly consentSource: ConsentSource | undefined;
  readonly knownNamesSource: KnownNamesSource | undefined;
  readonly stop: (() => Promise<void>) | undefined;
}

/** id модуля — как в tooling/architecture/modules.ts. */
const MODULE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Ключ модуля в дереве процедур и в фасадах соседей: id в camelCase (`legal-base` → `legalBase`). */
export function moduleKey(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_dash, letter: string) => letter.toUpperCase());
}

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
    sessionSource: spec.sessionSource,
    scopeVerifier: spec.scopeVerifier,
    consentSource: spec.consentSource,
    knownNamesSource: spec.knownNamesSource,
    stop: spec.stop,
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
