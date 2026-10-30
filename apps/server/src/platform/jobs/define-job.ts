// Задача (ADR-0008, .claude/rules/jobs-events.md): defineJob описывает очередь, нагрузку и обработчик. В нагрузке —
// только id (OBS-04: ни текстов, ни сумм; поле userId/householdId ловит tooling/checks/isolation.mjs), «чьи данные» —
// в конверте { scope, requestId, payload }: scope перепроверяется при выполнении (scope-verifier.ts) и становится
// ctx.s, requestId продолжает цепочку логов запроса, поставившего задачу (OBS-01). Помощник модуля (T-007) только
// раскладывает определения по реестрам — описание задачи здесь.
import { HouseholdId, UserId, type Scope } from "@kosht/kernel";
import { z } from "zod";
import type { ScopedDb } from "../db/scoped-db.ts";
import type { Logger } from "../logging/logger.ts";

/** Имя задачи и её очереди: `<модуль>.<глагол>` строчными (`receipts.recognize`). */
export const JOB_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

export interface JobOptions<P> {
  /** Больше — раньше (распознавание чека — 10); по умолчанию 0. */
  readonly priority?: number;
  /** Повторов при retryable-ошибке каталога (остальные ошибки не повторяются); по умолчанию 2. */
  readonly retryLimit?: number;
  /** Пауза между повторами, с; по умолчанию 0. */
  readonly retryDelaySeconds?: number;
  /** Задержка первого запуска, с: вместе с singletonKey схлопывает «шторм» (пересчёт после импорта). */
  readonly startAfterSeconds?: number;
  /**
   * Как часто worker спрашивает очередь именно этой задачи, с (не меньше 0,5 — предел pg-boss); по умолчанию — общая
   * частота процесса (2 с). Для задач, чей результат ждёт человек (уведомление о пороге лимита ≤ 3 с, BUD-03).
   */
  readonly pollingIntervalSeconds?: number;
  /** Сколько обработчик может работать, с; по умолчанию 15 мин (pg-boss). */
  readonly expireInSeconds?: number;
  /**
   * Ключ схлопывания — только `jobKey(scope, …)`: в очереди с ключом ждёт одна задача на ключ (политика short),
   * следующие такие же не ставятся, пока она не взята в работу.
   */
  singletonKey?(payload: P, scope: Scope): string;
}

/** Что получает обработчик: данные — только через s (ScopedDb владельца задачи). */
export interface JobContext {
  readonly s: ScopedDb;
  readonly requestId: string;
  readonly log: Logger;
  /** Остановка процесса или истёкший срок задачи. */
  readonly signal: AbortSignal;
  /** Прогресс 0…100 в журнале background_job_run (экран «Система»). */
  progress(percent: number): Promise<void>;
}

/** Схема нагрузки: проверка при постановке и при выполнении (Zod-объект из defineJob). */
export interface PayloadSchema<P> {
  safeParse(input: unknown): z.ZodSafeParseResult<P>;
}

export interface JobDef<P = unknown> {
  readonly name: string;
  readonly payload: PayloadSchema<P>;
  readonly options: JobOptions<P>;
  /** Идемпотентен: доставка «хотя бы раз», порядок не гарантирован — перечитывает состояние через ctx.s. */
  handle(ctx: JobContext, payload: P): Promise<void>;
}

export function defineJob<S extends z.ZodObject>(definition: {
  readonly name: string;
  readonly payload: S;
  readonly options?: JobOptions<z.output<S>>;
  handle(ctx: JobContext, payload: z.output<S>): Promise<void>;
}): JobDef<z.output<S>> {
  if (!JOB_NAME.test(definition.name)) {
    throw new RangeError(
      `Имя задачи «${definition.name}»: ожидается <модуль>.<глагол> строчными латинскими буквами.`,
    );
  }
  return {
    name: definition.name,
    payload: definition.payload,
    options: definition.options ?? {},
    handle: (ctx, payload) => definition.handle(ctx, payload),
  };
}

/**
 * Политика очереди: с ключом схлопывания — short (одна ожидающая задача на ключ), без ключа — standard. pg-boss
 * в standard ключ не схлопывает, а short без ключа держал бы одну ожидающую задачу на всю очередь.
 */
export function queuePolicy(job: JobDef): "short" | "standard" {
  return job.options.singletonKey === undefined ? "standard" : "short";
}

/** Конверт задачи в pg-boss: владелец, запрос-источник и нагрузка. */
export const JobEnvelope = z.strictObject({
  scope: z.strictObject({ userId: UserId, householdId: HouseholdId }),
  requestId: z.string().min(1).max(128),
  payload: z.unknown(),
});
export type JobEnvelope = z.infer<typeof JobEnvelope>;
