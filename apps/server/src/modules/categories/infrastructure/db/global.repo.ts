// Общие таблицы категоризации (publicTable): встроенные категории и глобальные правила — чтение через SystemDb.
import { asc } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type { GlobalRule } from "../../domain/match.ts";
import { globalCategoryRules, systemCategories } from "./schema.ts";

export interface SystemCategoryRow {
  readonly code: string;
  readonly kind: string;
  readonly icon: string;
  readonly color: string;
}

export async function listSystemCategories(db: SystemDb): Promise<SystemCategoryRow[]> {
  return db
    .select({
      code: systemCategories.code,
      kind: systemCategories.kind,
      icon: systemCategories.icon,
      color: systemCategories.color,
    })
    .from(systemCategories)
    .orderBy(asc(systemCategories.sort));
}

export async function listGlobalRules(db: SystemDb): Promise<GlobalRule[]> {
  const rows = await db
    .select({
      matcher: globalCategoryRules.matcher,
      pattern: globalCategoryRules.pattern,
      categoryCode: globalCategoryRules.categoryCode,
    })
    .from(globalCategoryRules);
  return rows.map((row) => ({ ...row, matcher: row.matcher as GlobalRule["matcher"] }));
}
