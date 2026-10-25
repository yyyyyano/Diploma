// Запросы к таблицам llm (systemTable) через SystemDb: реестр моделей и журнал расхода.
import { asc } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import { CAPABILITIES, type Capability } from "../../domain/tasks.ts";
import type { ModelRecord } from "../../domain/build-chain.ts";
import type { Price } from "../../domain/cost.ts";
import { llmModels, llmUsage } from "./schema.ts";

export type StoredModel = ModelRecord & Price;

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
  }));
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
