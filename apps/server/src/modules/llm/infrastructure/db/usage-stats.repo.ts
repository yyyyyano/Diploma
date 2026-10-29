// Цифры журнала расхода для «Запросов к ИИ» (ADM-20): суммы за период по задачам, по провайдерам и моделям, медиана
// времени ответа. Только агрегаты — текстов, пользователей и id запросов в журнале нет (OBS-04, ADM-22).
import { and, desc, gt, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import { llmUsage } from "./schema.ts";

export interface UsageTotals {
  readonly requests: number;
  readonly errors: number;
  /** Медиана времени ответа, мс; вызовов нет — null. */
  readonly medianMs: number | null;
}

export async function usageTotals(db: SystemDb, since: Date): Promise<UsageTotals> {
  const [row] = await db
    .select({
      requests: sql<number>`count(*)`.mapWith(Number),
      errors: sql<number>`count(*) filter (where ${llmUsage.errorCode} is not null)`.mapWith(
        Number,
      ),
      medianMs: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${llmUsage.ms})`.mapWith(
        (value: string | number | null) => (value === null ? null : Math.round(Number(value))),
      ),
    })
    .from(llmUsage)
    .where(gt(llmUsage.createdAt, since));
  return row ?? { requests: 0, errors: 0, medianMs: null };
}

export interface TaskUsage {
  readonly task: string;
  readonly requests: number;
  readonly tokens: number;
}

/** Запросы и токены по задачам, частые первыми. */
export async function usageByTask(db: SystemDb, since: Date): Promise<TaskUsage[]> {
  return db
    .select({
      task: llmUsage.task,
      requests: sql<number>`count(*)`.mapWith(Number),
      tokens:
        sql<number>`coalesce(sum(${llmUsage.inputTokens} + ${llmUsage.outputTokens}), 0)`.mapWith(
          Number,
        ),
    })
    .from(llmUsage)
    .where(gt(llmUsage.createdAt, since))
    .groupBy(llmUsage.task)
    .orderBy(desc(sql`count(*)`), llmUsage.task);
}

export interface ModelUsage {
  readonly provider: string;
  readonly model: string;
  readonly requests: number;
  readonly errors: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Расход по связке «провайдер, модель»: из неё сервер собирает провайдеров, облако и локально, стоимость по прайсу. */
export async function usageByModel(db: SystemDb, since: Date): Promise<ModelUsage[]> {
  return db
    .select({
      provider: llmUsage.provider,
      model: llmUsage.model,
      requests: sql<number>`count(*)`.mapWith(Number),
      errors: sql<number>`count(*) filter (where ${llmUsage.errorCode} is not null)`.mapWith(
        Number,
      ),
      inputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)`.mapWith(Number),
      outputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)`.mapWith(Number),
    })
    .from(llmUsage)
    .where(and(gt(llmUsage.createdAt, since)))
    .groupBy(llmUsage.provider, llmUsage.model);
}
