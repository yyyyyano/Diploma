// Справочник контрагентов (publicTable merchant_directory, merchant_aliases) — только через SystemDb модуля merchants.
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import { merchantAliases, merchantDirectory } from "./schema.ts";

export interface DirectoryHit {
  readonly alias: string;
  readonly merchantId: string;
  readonly name: string;
  readonly categoryCode: string | null;
}

const hitColumns = {
  alias: merchantAliases.alias,
  merchantId: merchantDirectory.id,
  name: merchantDirectory.name,
  categoryCode: merchantDirectory.categoryCode,
};

/** Точные совпадения ключей с алиасами — пачкой. */
export async function findAliases(db: SystemDb, keys: readonly string[]): Promise<DirectoryHit[]> {
  if (keys.length === 0) return [];
  return db
    .select(hitColumns)
    .from(merchantAliases)
    .innerJoin(merchantDirectory, eq(merchantDirectory.id, merchantAliases.merchantId))
    .where(inArray(merchantAliases.alias, [...keys]));
}

/** Самый похожий алиас по pg_trgm (similarity ≥ порога) или undefined. */
export async function findSimilarAlias(
  db: SystemDb,
  key: string,
  threshold: number,
): Promise<DirectoryHit | undefined> {
  const score = sql<number>`similarity(${merchantAliases.alias}, ${key})`;
  const rows = await db
    .select(hitColumns)
    .from(merchantAliases)
    .innerJoin(merchantDirectory, eq(merchantDirectory.id, merchantAliases.merchantId))
    .where(sql`${score} >= ${threshold}`)
    .orderBy(desc(score), merchantAliases.alias)
    .limit(1);
  return rows[0];
}
