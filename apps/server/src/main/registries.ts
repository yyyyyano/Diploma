// Реестры корня композиции (ARCHITECTURE §3, §5): части модулей раскладываются по реестрам вместо правки ядра —
// роутеры, события, задачи и подписки, расписания и обходы, инструменты агента, каналы доставки, обработчики отмены
// и подтверждения, владельцы данных, настройки, секреты, правила частоты. Пустые списки — норма (модули ещё пустые);
// повторное имя — ошибка при старте: иначе второй обработчик молча заменил бы первый.
import type { UserDataDef } from "../platform/db/user-data.ts";
import type { EventDef } from "../platform/events/define-event.ts";
import type { SubscriptionDef } from "../platform/events/define-subscription.ts";
import type { ModuleRouter } from "../platform/http/procedures.ts";
import type { SessionResolver } from "../platform/http/session.ts";
import type { JobDef } from "../platform/jobs/define-job.ts";
import type { ScopeVerifier } from "../platform/jobs/scope-verifier.ts";
import type { ScheduleDef } from "../platform/jobs/schedule.ts";
import type { SweepDef } from "../platform/jobs/sweep.ts";
import {
  moduleKey,
  type ActionHandler,
  type DeliveryChannel,
  type ModuleDescriptor,
} from "../platform/module/define-module.ts";
import type { RateRule } from "../platform/rate-limit/rate-limit.ts";
import type { SecretDef } from "../platform/secrets/secrets.ts";
import type { SettingDef } from "../platform/settings/settings.ts";
import type { ToolDef } from "../platform/tools/define-tool.ts";

export interface Registries {
  readonly modules: readonly ModuleDescriptor[];
  /** Ветки дерева процедур: ключ — id модуля в camelCase (main/router.ts). */
  readonly routers: Readonly<Record<string, ModuleRouter>>;
  readonly events: ReadonlyMap<string, EventDef>;
  /** Очереди процесса: задачи модулей и задачи подписок (задачи обходов добавляет jobs.start). */
  readonly jobs: readonly JobDef[];
  readonly subscriptions: readonly SubscriptionDef[];
  readonly schedules: readonly ScheduleDef[];
  readonly sweeps: readonly SweepDef[];
  readonly tools: ReadonlyMap<string, ToolDef>;
  readonly deliveryChannels: ReadonlyMap<string, DeliveryChannel>;
  readonly undo: ReadonlyMap<string, ActionHandler>;
  readonly confirm: ReadonlyMap<string, ActionHandler>;
  /** Владельцы данных (PRIV-05/06): id модуля → его пользовательские таблицы. */
  readonly userData: ReadonlyMap<string, UserDataDef>;
  readonly settings: ReadonlyMap<string, SettingDef<unknown>>;
  readonly secrets: ReadonlyMap<string, SecretDef>;
  readonly rateRules: ReadonlyMap<string, RateRule>;
  /** Источник сессий сайта (модуль входа); нет — сессии нет ни у кого. */
  readonly sessionSource: SessionResolver | undefined;
  /** Перепроверка владельца задач (модуль входа); нет — задачи отбрасываются. */
  readonly scopeVerifier: ScopeVerifier | undefined;
}

/** Повторное имя в реестре: в тексте — вид реестра, имя и оба модуля. */
export class RegistryError extends Error {
  override readonly name = "RegistryError";
}

/** Реестр с памятью о модуле-владельце каждого имени. */
class Registry<T> {
  readonly #kind: string;
  readonly #items = new Map<string, { readonly value: T; readonly module: string }>();

  constructor(kind: string) {
    this.#kind = kind;
  }

  /** same — то же определение под тем же именем не считается повтором (задача обхода, объявленная и в jobs). */
  add(name: string, value: T, module: string, same: (a: T, b: T) => boolean = () => false): void {
    const known = this.#items.get(name);
    if (known !== undefined && !(known.module === module && same(known.value, value))) {
      throw new RegistryError(
        `Реестр «${this.#kind}»: «${name}» объявлен дважды (модули ${known.module} и ${module}).`,
      );
    }
    this.#items.set(name, { value, module });
  }

  values(): T[] {
    return [...this.#items.values()].map((item) => item.value);
  }

  map(): ReadonlyMap<string, T> {
    return new Map([...this.#items].map(([name, item]) => [name, item.value]));
  }
}

export function buildRegistries(modules: readonly ModuleDescriptor[]): Registries {
  const ids = new Registry<string>("модули");
  const routers: Record<string, ModuleRouter> = {};
  const events = new Registry<EventDef>("события");
  // Задачи, подписки, расписания и обходы — очереди pg-boss: имя одно на все виды.
  const queues = new Registry<unknown>("очереди задач");
  const jobs = new Registry<JobDef>("задачи");
  const subscriptions: SubscriptionDef[] = [];
  const schedules: ScheduleDef[] = [];
  const sweeps: SweepDef[] = [];
  const tools = new Registry<ToolDef>("инструменты агента");
  const channels = new Registry<DeliveryChannel>("каналы доставки");
  const undo = new Registry<ActionHandler>("обработчики отмены");
  const confirm = new Registry<ActionHandler>("обработчики подтверждения");
  const tables = new Registry<string>("таблицы владельцев данных");
  const userData = new Registry<UserDataDef>("владельцы данных");
  const settings = new Registry<SettingDef<unknown>>("настройки");
  const secrets = new Registry<SecretDef>("секреты");
  const rateRules = new Registry<RateRule>("правила частоты");
  // Один на процесс: второй модуль с ними — ошибка старта, а не подмена входа.
  const sessionSource = new Registry<SessionResolver>("источник сессий");
  const scopeVerifier = new Registry<ScopeVerifier>("проверка scope задач");
  const sameObject = (a: unknown, b: unknown) => a === b;

  for (const m of modules) {
    ids.add(m.id, m.id, m.id);
    if (m.router !== undefined) routers[moduleKey(m.id)] = m.router;
    for (const event of m.events) events.add(event.name, event, m.id);
    for (const job of m.jobs) {
      queues.add(job.name, job, m.id, sameObject);
      jobs.add(job.name, job, m.id);
    }
    for (const subscription of m.subscriptions) {
      queues.add(subscription.job.name, subscription.job, m.id);
      jobs.add(subscription.job.name, subscription.job, m.id);
      subscriptions.push(subscription);
    }
    for (const schedule of m.schedules) {
      queues.add(schedule.name, schedule, m.id);
      schedules.push(schedule);
    }
    for (const sweep of m.sweeps) {
      queues.add(sweep.name, sweep, m.id);
      queues.add(sweep.job.name, sweep.job, m.id, sameObject);
      sweeps.push(sweep);
    }
    for (const tool of m.tools) tools.add(tool.name, tool, m.id);
    for (const channel of m.deliveryChannels) channels.add(channel.name, channel, m.id);
    for (const [name, handler] of Object.entries(m.undo)) undo.add(name, handler, m.id);
    for (const [name, handler] of Object.entries(m.confirm)) confirm.add(name, handler, m.id);
    if (m.userData !== undefined) {
      userData.add(m.id, m.userData, m.id);
      for (const table of m.userData.tableNames) tables.add(table, table, m.id);
    }
    for (const setting of m.settings) settings.add(setting.key, setting, m.id);
    for (const secret of m.secrets) secrets.add(secret.name, secret, m.id);
    for (const rule of m.rateRules) rateRules.add(rule.name, rule, m.id);
    if (m.sessionSource !== undefined) sessionSource.add("session", m.sessionSource, m.id);
    if (m.scopeVerifier !== undefined) scopeVerifier.add("scope", m.scopeVerifier, m.id);
  }

  return {
    modules: [...modules],
    routers,
    events: events.map(),
    jobs: jobs.values(),
    subscriptions,
    schedules,
    sweeps,
    tools: tools.map(),
    deliveryChannels: channels.map(),
    undo: undo.map(),
    confirm: confirm.map(),
    userData: userData.map(),
    settings: settings.map(),
    secrets: secrets.map(),
    rateRules: rateRules.map(),
    sessionSource: sessionSource.values()[0],
    scopeVerifier: scopeVerifier.values()[0],
  };
}
