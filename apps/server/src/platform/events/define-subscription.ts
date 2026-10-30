// Подписка модуля на событие (ADR-0004, ADR-0008, ARCHITECTURE §5): своя очередь `evt.<событие>.<модуль>` политики
// short — задача фасада jobs (pg-boss здесь не нужен). Доставка «хотя бы раз», порядок не гарантирован: обработчик
// идемпотентен и перечитывает состояние через ctx.s. Ключ схлопывания — jobKey(scope, …) модуля (пересчёт после
// импорта — один); без ключа модуля — jobKey(scope, отпечаток нагрузки): очередь short без ключа держала бы одну
// ожидающую задачу на все домохозяйства, а одинаковые ожидающие события одного домохозяйства схлопываются без потерь
// (обработчик ещё не начал и прочитает всё, что успело измениться).
import { createHash } from "node:crypto";
import type { Scope } from "@kosht/kernel";
import type { JobContext, JobDef } from "../jobs/define-job.ts";
import { jobKey } from "../jobs/job-key.ts";
import type { EventDef, EventPayload } from "./define-event.ts";

const MODULE_ID = /^[a-z][a-z0-9-]*$/;

export interface SubscriptionOptions<P> {
  /** Ключ схлопывания — только jobKey(scope, …). */
  singletonKey?(payload: P, scope: Scope): string;
  /** Задержка, с: вместе с ключом схлопывает «шторм» событий. */
  readonly startAfterSeconds?: number;
  /** Как часто worker спрашивает очередь подписки, с (≥ 0,5): обработчик, результат которого ждёт человек. */
  readonly pollingIntervalSeconds?: number;
  /** Повторов при retryable-ошибке каталога; по умолчанию 2. */
  readonly retryLimit?: number;
}

export interface SubscriptionDef<P extends EventPayload = EventPayload> {
  readonly event: EventDef<P>;
  /** Модуль-слушатель (id из modules.ts). */
  readonly module: string;
  /** Задача очереди evt.<событие>.<модуль>. */
  readonly job: JobDef<P>;
}

export function defineSubscription<P extends EventPayload>(definition: {
  readonly event: EventDef<P>;
  readonly module: string;
  readonly options?: SubscriptionOptions<P>;
  handle(ctx: JobContext, payload: P): Promise<void>;
}): SubscriptionDef<P> {
  if (!MODULE_ID.test(definition.module)) {
    throw new RangeError(
      `Подписка на ${definition.event.name}: «${definition.module}» — не id модуля.`,
    );
  }
  const options = definition.options ?? {};
  const job: JobDef<P> = {
    name: `evt.${definition.event.name}.${definition.module}`,
    payload: definition.event.payload,
    options: {
      ...(options.startAfterSeconds === undefined
        ? {}
        : { startAfterSeconds: options.startAfterSeconds }),
      ...(options.retryLimit === undefined ? {} : { retryLimit: options.retryLimit }),
      ...(options.pollingIntervalSeconds === undefined
        ? {}
        : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
      singletonKey: (payload, scope) =>
        options.singletonKey?.(payload, scope) ?? jobKey(scope, fingerprint(payload)),
    },
    handle: (ctx, payload) => definition.handle(ctx, payload),
  };
  return { event: definition.event, module: definition.module, job };
}

/** Отпечаток нагрузки: одинаковые события — один ключ; сами id в ключ не идут (только хеш). */
function fingerprint(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}
