// SQL поиска по законам (LAW-21, LAW-22, ADR-0007): точное обращение (алиас + номер статьи), гибрид «полнотекстовый
// `russian` + halfvec HNSW» со слиянием рангов RRF (k = 60), карточка акта. Только действующие акты и действующие
// версии фрагментов. SystemDb модуля; данные пользователя здесь не участвуют.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import { legalActAliases, legalActs, legalFragmentVersions, legalFragments } from "./schema.ts";

/** Id первой модели из миграции: частичный HNSW-индекс построен под неё, запрос называет её литералом (параметр индекс не использует). */
export const FIRST_MODEL_ID = "019e0000-0000-7000-8000-000000000001";
/** RRF (ADR-0007): 1 / (k + ранг). */
export const RRF_K = 60;
/** Сколько кандидатов берёт каждая из двух веток. */
const BRANCH_LIMIT = 50;

export interface FragmentRow {
  readonly versionId: string;
  readonly pravoId: string;
  readonly actTitle: string;
  readonly pathKey: string;
  readonly path: string;
  readonly heading: string | null;
  readonly text: string;
  readonly kind: string;
  readonly excluded: boolean;
  readonly articleNo: string | null;
}

const FRAGMENT_COLUMNS = {
  versionId: legalFragmentVersions.id,
  pravoId: legalActs.pravoId,
  actTitle: legalActs.title,
  pathKey: legalFragments.pathKey,
  path: legalFragmentVersions.searchPath,
  heading: legalFragmentVersions.heading,
  text: legalFragmentVersions.body,
  kind: legalFragmentVersions.kind,
  excluded: legalFragmentVersions.excluded,
  articleNo: legalFragments.articleNo,
} as const;

/** Акты с этим кратким именем (только действующие): «нк» — два акта. */
export async function actsByAlias(
  db: SystemDb,
  alias: string,
): Promise<readonly { id: string; pravoId: string }[]> {
  return db
    .select({ id: legalActAliases.actId, pravoId: legalActs.pravoId })
    .from(legalActAliases)
    .innerJoin(legalActs, eq(legalActs.id, legalActAliases.actId))
    .where(and(eq(legalActAliases.alias, alias), eq(legalActs.status, "active")));
}

/** Фрагменты статьи (и пункта, если назван) действующей версии; исключённая статья возвращается со статусом. */
export async function articleFragments(
  db: SystemDb,
  actId: string,
  articleNo: string,
  point: string | null,
): Promise<readonly FragmentRow[]> {
  const rows = await db
    .select(FRAGMENT_COLUMNS)
    .from(legalFragments)
    .innerJoin(legalFragmentVersions, eq(legalFragmentVersions.fragmentId, legalFragments.id))
    .innerJoin(legalActs, eq(legalActs.id, legalFragments.actId))
    .where(
      and(
        eq(legalFragments.actId, actId),
        eq(legalFragments.articleNo, articleNo),
        eq(legalFragmentVersions.isCurrent, true),
      ),
    )
    .orderBy(legalFragments.position);
  if (point === null) return rows;
  const wanted = rows.filter(
    (r) =>
      r.pathKey === `a${articleNo}/p${point}` || r.pathKey.startsWith(`a${articleNo}/p${point}/`),
  );
  return wanted.length > 0 ? wanted : rows;
}

/** Вывести версии фрагментов по id (порядок — как в списке). */
export async function fragmentsByVersionIds(
  db: SystemDb,
  ids: readonly string[],
): Promise<readonly FragmentRow[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select(FRAGMENT_COLUMNS)
    .from(legalFragmentVersions)
    .innerJoin(legalFragments, eq(legalFragments.id, legalFragmentVersions.fragmentId))
    .innerJoin(legalActs, eq(legalActs.id, legalFragments.actId))
    .where(inArray(legalFragmentVersions.id, [...ids]));
  const byId = new Map(rows.map((r) => [r.versionId, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is FragmentRow => r !== undefined);
}

export interface HybridQuery {
  /** Строка для `to_tsquery('russian', …)` или null. */
  readonly tsQuery: string | null;
  /** Вектор запроса (1024) или null — без модели ветка векторов пропускается. */
  readonly vector: readonly number[] | null;
  readonly limit: number;
}

/** Гибрид: два списка рангов → RRF → id версий по убыванию оценки. */
export async function hybridIds(db: SystemDb, q: HybridQuery): Promise<readonly string[]> {
  if (q.tsQuery === null && q.vector === null) return [];
  const vector = q.vector === null ? null : `[${q.vector.join(",")}]`;
  const result = await db.execute<{ id: string }>(sql`
    with
    q as (select to_tsquery('russian', ${q.tsQuery ?? ""}) as tsq),
    fts as (
      select t.id, row_number() over (order by t.rk desc, t.id) as rnk
      from (
        select v.id, ts_rank(v.search_tsv, q.tsq) as rk
        from q, legal_fragment_versions v
        join legal_fragments f on f.id = v.fragment_id
        join legal_acts a on a.id = f.act_id
        where ${q.tsQuery === null ? sql`false` : sql`true`}
          and v.is_current and not v.excluded and a.status = 'active'
          and v.search_tsv @@ q.tsq
        order by rk desc, v.id
        limit ${BRANCH_LIMIT}
      ) t
    ),
    vec as (
      select e.version_id as id,
             row_number() over (order by e.embedding <=> ${vector}::halfvec(1024)) as rnk
      from legal_fragment_embeddings e
      join legal_fragment_versions v on v.id = e.version_id
      join legal_fragments f on f.id = v.fragment_id
      join legal_acts a on a.id = f.act_id
      where ${vector === null ? sql`false` : sql`true`}
        and e.model_id = '019e0000-0000-7000-8000-000000000001'
        and v.is_current and not v.excluded and a.status = 'active'
      order by e.embedding <=> ${vector}::halfvec(1024)
      limit ${BRANCH_LIMIT}
    )
    select coalesce(fts.id, vec.id) as id
    from fts full join vec on fts.id = vec.id
    order by coalesce(1.0 / (${RRF_K} + fts.rnk), 0) + coalesce(1.0 / (${RRF_K} + vec.rnk), 0) desc, coalesce(fts.id, vec.id)
    limit ${q.limit}
  `);
  return result.rows.map((r) => r.id);
}

/** Определения акта (вид «definitions») — для расширения выдачи. */
export async function definitionIds(
  db: SystemDb,
  pravoIds: readonly string[],
): Promise<readonly string[]> {
  if (pravoIds.length === 0) return [];
  const rows = await db
    .select({ id: legalFragmentVersions.id })
    .from(legalFragmentVersions)
    .innerJoin(legalFragments, eq(legalFragments.id, legalFragmentVersions.fragmentId))
    .innerJoin(legalActs, eq(legalActs.id, legalFragments.actId))
    .where(
      and(
        inArray(legalActs.pravoId, [...pravoIds]),
        eq(legalFragmentVersions.kind, "definitions"),
        eq(legalFragmentVersions.isCurrent, true),
      ),
    )
    .orderBy(legalFragments.position)
    .limit(pravoIds.length);
  return rows.map((r) => r.id);
}

/** Карточка акта: реквизиты, состояние, число действующих фрагментов. */
export async function actCardRow(db: SystemDb, pravoId: string) {
  const rows = await db
    .select({
      pravoId: legalActs.pravoId,
      title: legalActs.title,
      kind: legalActs.kind,
      isNpa: legalActs.isNpa,
      hasText: legalActs.hasText,
      status: legalActs.status,
      loadState: legalActs.loadState,
      loadedAt: legalActs.loadedAt,
      articleCount: legalActs.articleCount,
    })
    .from(legalActs)
    .where(eq(legalActs.pravoId, pravoId));
  return rows[0];
}
