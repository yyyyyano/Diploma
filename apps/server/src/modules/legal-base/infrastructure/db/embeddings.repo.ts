// Векторы фрагментов (LAW-23, ADR-0007): у вектора — модель с именем и версией, только у действующих версий. Строки
// без вектора выбираются по активной модели: смена модели сама превращается в «нет вектора» у всех и фоновую
// переиндексацию с прогрессом. SystemDb модуля.
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import { legalEmbeddingModels, legalFragmentEmbeddings, legalFragmentVersions } from "./schema.ts";

export interface EmbeddingModel {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly dimensions: number;
}

export async function activeModel(db: SystemDb): Promise<EmbeddingModel | undefined> {
  const rows = await db
    .select({
      id: legalEmbeddingModels.id,
      name: legalEmbeddingModels.name,
      version: legalEmbeddingModels.version,
      dimensions: legalEmbeddingModels.dimensions,
    })
    .from(legalEmbeddingModels)
    .where(eq(legalEmbeddingModels.active, true))
    .limit(1);
  return rows[0];
}

/** Действующие версии без вектора активной модели — порцией. */
export async function pendingVersions(
  db: SystemDb,
  modelId: string,
  limit: number,
): Promise<readonly { id: string; text: string }[]> {
  return db
    .select({
      id: legalFragmentVersions.id,
      text: legalFragmentVersions.searchPath,
      body: legalFragmentVersions.body,
    })
    .from(legalFragmentVersions)
    .leftJoin(
      legalFragmentEmbeddings,
      and(
        eq(legalFragmentEmbeddings.versionId, legalFragmentVersions.id),
        eq(legalFragmentEmbeddings.modelId, modelId),
      ),
    )
    .where(
      and(
        eq(legalFragmentVersions.isCurrent, true),
        eq(legalFragmentVersions.excluded, false),
        isNull(legalFragmentEmbeddings.versionId),
      ),
    )
    .limit(limit)
    .then((rows) => rows.map((r) => ({ id: r.id, text: `${r.text}\n${r.body}` })));
}

export async function saveEmbeddings(
  db: SystemDb,
  modelId: string,
  rows: readonly { versionId: string; vector: number[] }[],
  at: Date,
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(legalFragmentEmbeddings)
    .values(
      rows.map((r) => ({ versionId: r.versionId, modelId, embedding: r.vector, embeddedAt: at })),
    )
    .onConflictDoUpdate({
      target: legalFragmentEmbeddings.versionId,
      set: {
        modelId,
        embeddedAt: at,
        embedding: sql`excluded.embedding`,
      },
    });
}

/** Сколько действующих версий всего и сколько уже с вектором активной модели. */
export async function vectorCounts(
  db: SystemDb,
  modelId: string,
): Promise<{ total: number; embedded: number }> {
  const [total] = await db
    .select({ n: count() })
    .from(legalFragmentVersions)
    .where(
      and(eq(legalFragmentVersions.isCurrent, true), eq(legalFragmentVersions.excluded, false)),
    );
  const [embedded] = await db
    .select({ n: count() })
    .from(legalFragmentEmbeddings)
    .innerJoin(
      legalFragmentVersions,
      eq(legalFragmentVersions.id, legalFragmentEmbeddings.versionId),
    )
    .where(
      and(
        eq(legalFragmentEmbeddings.modelId, modelId),
        eq(legalFragmentVersions.isCurrent, true),
        eq(legalFragmentVersions.excluded, false),
      ),
    );
  return { total: total?.n ?? 0, embedded: embedded?.n ?? 0 };
}
