// Запросы к таблицам llm (systemTable) через SystemDb: реестр моделей, порядок цепочек и журнал расхода.
import { asc, inArray, lt, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import { CAPABILITIES, type Capability } from "../../domain/tasks.ts";
import type { ModelRecord } from "../../domain/build-chain.ts";
import type { Price } from "../../domain/cost.ts";
import { llmModels, llmTaskChains, llmUsage } from "./schema.ts";

/** Лимиты бесплатного тарифа (LLM-05): null — лимит не опубликован, считать нечего. */
export interface RateLimits {
  readonly rpm: number | null;
  readonly tpm: number | null;
  readonly rpd: number | null;
  readonly tpd: number | null;
}

export type StoredModel = ModelRecord &
  Price & {
    readonly contextTokens: number;
    readonly limits: RateLimits;
    /** Администратор разрешил выбирать модель в чате (LLM-10). */
    readonly userSelectable: boolean;
  };

const isCapability = (value: string): value is Capability =>
  CAPABILITIES.some((known) => known === value);

/** Все записи реестра (их десятки): цепочку по задаче собирает domain/build-chain.ts. */
export async function listModels(db: SystemDb): Promise<StoredModel[]> {
  const rows = await db
    .select()
    .from(llmModels)
    .orderBy(asc(llmModels.priority), asc(llmModels.id));
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    modelId: row.modelId,
    cloud: row.cloud,
    // Неизвестная возможность (запись новее кода) не даёт модели лишних прав — просто не учитывается.
    capabilities: row.capabilities.filter(isCapability),
    priority: row.priority,
    enabled: row.enabled,
    inputMicrosPerMillion: row.inputMicrosPerMillion,
    outputMicrosPerMillion: row.outputMicrosPerMillion,
    contextTokens: row.contextTokens,
    limits: { rpm: row.rpm, tpm: row.tpm, rpd: row.rpd, tpd: row.tpd },
    userSelectable: row.userSelectable,
  }));
}

/** Порядок цепочек по задачам (ADM-50): задача → id записей реестра по возрастанию позиции. */
export async function listChains(db: SystemDb): Promise<Map<string, string[]>> {
  const rows = await db
    .select()
    .from(llmTaskChains)
    .orderBy(asc(llmTaskChains.task), asc(llmTaskChains.position), asc(llmTaskChains.modelId));
  const chains = new Map<string, string[]>();
  for (const row of rows) chains.set(row.task, [...(chains.get(row.task) ?? []), row.modelId]);
  return chains;
}

/** Расход модели в окнах лимитов (LLM-05): запросы и токены (вход + выход) за минуту и за сутки. */
export interface UsageWindows {
  readonly requestsMinute: number;
  readonly tokensMinute: number;
  readonly requestsDay: number;
  readonly tokensDay: number;
}

/**
 * Расход каждой модели из журнала (llm_usage общий для api и worker, поэтому лимитёр восстанавливается после
 * перезапуска и видит чужой процесс). Ключ — `<провайдер>/<модель>`; моделей без строк в окнах в ответе нет.
 */
export async function usageWindows(db: SystemDb, now: Date): Promise<Map<string, UsageWindows>> {
  const minuteAgo = new Date(now.getTime() - 60_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const tokens = sql`(${llmUsage.inputTokens} + ${llmUsage.outputTokens})`;
  const rows = await db
    .select({
      provider: llmUsage.provider,
      model: llmUsage.model,
      requestsMinute:
        sql<number>`count(*) filter (where ${llmUsage.createdAt} > ${minuteAgo})`.mapWith(Number),
      tokensMinute:
        sql<number>`coalesce(sum(${tokens}) filter (where ${llmUsage.createdAt} > ${minuteAgo}), 0)`.mapWith(
          Number,
        ),
      requestsDay: sql<number>`count(*)`.mapWith(Number),
      tokensDay: sql<number>`coalesce(sum(${tokens}), 0)`.mapWith(Number),
    })
    .from(llmUsage)
    .where(sql`${llmUsage.createdAt} > ${dayAgo}`)
    .groupBy(llmUsage.provider, llmUsage.model);
  return new Map(
    rows.map(({ provider, model, ...windows }) => [`${provider}/${model}`, windows] as const),
  );
}

/** Удалить строки журнала старше срока (LLM-06: 90 дней) пачкой — долгой блокировки таблицы нет; сколько удалено. */
export async function deleteUsageBefore(
  db: SystemDb,
  before: Date,
  limit: number,
): Promise<number> {
  const old = db
    .select({ id: llmUsage.id })
    .from(llmUsage)
    .where(lt(llmUsage.createdAt, before))
    .limit(limit);
  const rows = await db
    .delete(llmUsage)
    .where(inArray(llmUsage.id, old))
    .returning({ id: llmUsage.id });
  return rows.length;
}

export interface UsageRow {
  readonly task: string;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly ms: number;
  readonly costMicros: number;
  readonly errorCode: string | null;
  readonly createdAt: Date;
}

/** Строка журнала расхода — без текстов (OBS-04). */
export async function insertUsage(db: SystemDb, row: UsageRow): Promise<void> {
  await db.insert(llmUsage).values(row);
}
