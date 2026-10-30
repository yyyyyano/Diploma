// Чтение для «Базы законов» (LEGAL-11): каталог, оглавление и части текста акта — только SystemDb модуля, только чтение.
import { and, asc, count, eq, isNotNull, ne, notLike, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import {
  legalActSnapshots,
  legalActs,
  legalFragmentVersions,
  legalFragments,
  legalPendingChanges,
} from "./schema.ts";

export interface CatalogRow {
  readonly pravoId: string;
  readonly title: string;
  readonly kind: string;
  readonly isNpa: boolean;
  readonly hasText: boolean;
  readonly status: string;
  readonly repealedOn: string | null;
  readonly topic: string | null;
  readonly editionAt: Date | null;
  readonly pending: number;
}

/** Все акты каталога с днём действующей редакции и числом принятых, но не вошедших в текст изменений. */
export async function catalogRows(db: SystemDb): Promise<CatalogRow[]> {
  const pending = db
    .select({ actId: legalPendingChanges.actId, n: count().as("n") })
    .from(legalPendingChanges)
    .where(eq(legalPendingChanges.status, "pending"))
    .groupBy(legalPendingChanges.actId)
    .as("pending");
  const rows = await db
    .select({
      pravoId: legalActs.pravoId,
      title: legalActs.title,
      kind: legalActs.kind,
      isNpa: legalActs.isNpa,
      hasText: legalActs.hasText,
      status: legalActs.status,
      repealedOn: legalActs.repealedOn,
      topic: legalActs.topic,
      editionAt: legalActSnapshots.fetchedAt,
      pending: sql<number>`coalesce(${pending.n}, 0)`.mapWith(Number),
    })
    .from(legalActs)
    .leftJoin(legalActSnapshots, eq(legalActSnapshots.id, legalActs.currentSnapshotId))
    .leftJoin(pending, eq(pending.actId, legalActs.id))
    .where(ne(legalActs.status, "excluded"))
    .orderBy(asc(legalActs.title));
  return rows;
}

export interface TocRow {
  readonly articleNo: string;
  readonly searchPath: string;
  readonly heading: string | null;
}

/** Статьи акта по порядку: головной фрагмент статьи (ключ без «/»), у него путь «акт › раздел › глава › Статья N». */
export async function articleToc(db: SystemDb, actId: string): Promise<TocRow[]> {
  const rows = await db
    .select({
      articleNo: legalFragments.articleNo,
      searchPath: legalFragmentVersions.searchPath,
      heading: legalFragmentVersions.heading,
    })
    .from(legalFragments)
    .innerJoin(legalFragmentVersions, eq(legalFragmentVersions.fragmentId, legalFragments.id))
    .where(
      and(
        eq(legalFragments.actId, actId),
        isNotNull(legalFragments.articleNo),
        notLike(legalFragments.pathKey, "%/%"),
        eq(legalFragmentVersions.isCurrent, true),
      ),
    )
    .orderBy(asc(legalFragments.position));
  return rows.flatMap((r) => (r.articleNo === null ? [] : [{ ...r, articleNo: r.articleNo }]));
}

/** Сколько действующих фрагментов без статьи у акта (указы, постановления: единица — пункт). */
export async function looseFragmentCount(db: SystemDb, actId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(legalFragments)
    .innerJoin(legalFragmentVersions, eq(legalFragmentVersions.fragmentId, legalFragments.id))
    .where(
      and(
        eq(legalFragments.actId, actId),
        sql`${legalFragments.articleNo} is null`,
        eq(legalFragmentVersions.isCurrent, true),
      ),
    );
  return rows[0]?.n ?? 0;
}

export interface ReaderFragment {
  readonly versionId: string;
  readonly pathKey: string;
  readonly heading: string | null;
  readonly text: string;
  readonly excluded: boolean;
}

const READER_COLUMNS = {
  versionId: legalFragmentVersions.id,
  pathKey: legalFragments.pathKey,
  heading: legalFragmentVersions.heading,
  text: legalFragmentVersions.body,
  excluded: legalFragmentVersions.excluded,
} as const;

/** Действующие фрагменты одной статьи по порядку. */
export async function articleText(
  db: SystemDb,
  actId: string,
  articleNo: string,
): Promise<ReaderFragment[]> {
  return db
    .select(READER_COLUMNS)
    .from(legalFragments)
    .innerJoin(legalFragmentVersions, eq(legalFragmentVersions.fragmentId, legalFragments.id))
    .where(
      and(
        eq(legalFragments.actId, actId),
        eq(legalFragments.articleNo, articleNo),
        eq(legalFragmentVersions.isCurrent, true),
      ),
    )
    .orderBy(asc(legalFragments.position));
}

/** Страница текста акта без статей: `size` фрагментов по порядку, начиная с `page` (с 1). */
export async function loosePage(
  db: SystemDb,
  actId: string,
  page: number,
  size: number,
): Promise<ReaderFragment[]> {
  return db
    .select(READER_COLUMNS)
    .from(legalFragments)
    .innerJoin(legalFragmentVersions, eq(legalFragmentVersions.fragmentId, legalFragments.id))
    .where(
      and(
        eq(legalFragments.actId, actId),
        sql`${legalFragments.articleNo} is null`,
        eq(legalFragmentVersions.isCurrent, true),
      ),
    )
    .orderBy(asc(legalFragments.position))
    .limit(size)
    .offset((page - 1) * size);
}

/** Время снимка действующей редакции. */
export async function currentFetchedAt(db: SystemDb, actId: string): Promise<Date | null> {
  const rows = await db
    .select({ at: legalActSnapshots.fetchedAt })
    .from(legalActs)
    .innerJoin(legalActSnapshots, eq(legalActSnapshots.id, legalActs.currentSnapshotId))
    .where(eq(legalActs.id, actId));
  return rows[0]?.at ?? null;
}
