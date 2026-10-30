// Каталог актов, снимки и фрагменты (LAW-07, LAW-20, LAW-39) — только через SystemDb модуля legal-base. Запись снимка и
// фрагментов — одна транзакция, без сети внутри: страницу читают до неё.
import { and, count, eq, inArray } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type { ParsedFragment } from "../../domain/build-fragments.ts";
import type { CatalogEntry } from "../../domain/start-catalog.ts";
import { isNpa } from "../../domain/start-catalog.ts";
import {
  legalActSnapshots,
  legalActs,
  legalFragmentVersions,
  legalFragments,
  legalUpdateLog,
  type ActLoadState,
  type ActSource,
} from "./schema.ts";

export interface ActRow {
  readonly id: string;
  readonly pravoId: string;
  readonly title: string;
  readonly hasText: boolean;
  readonly loadState: ActLoadState;
  readonly currentSnapshotId: string | null;
}

const ACT_COLUMNS = {
  id: legalActs.id,
  pravoId: legalActs.pravoId,
  title: legalActs.title,
  hasText: legalActs.hasText,
  loadState: legalActs.loadState,
  currentSnapshotId: legalActs.currentSnapshotId,
} as const;

function asRow(row: {
  id: string;
  pravoId: string;
  title: string;
  hasText: boolean;
  loadState: string;
  currentSnapshotId: string | null;
}): ActRow {
  return { ...row, loadState: row.loadState as ActLoadState };
}

/** Завести акты каталога; уже известные не трогаются. Акт без текста сразу получает состояние «только карточка». */
export async function seedActs(
  db: SystemDb,
  entries: readonly CatalogEntry[],
  source: ActSource,
): Promise<void> {
  await db
    .insert(legalActs)
    .values(
      entries.map((e) => ({
        pravoId: e.pravoId,
        title: e.title,
        kind: e.kind,
        isNpa: isNpa(e.kind),
        hasText: e.hasText,
        source,
        loadState: e.hasText ? "pending" : "card-only",
      })),
    )
    .onConflictDoNothing({ target: legalActs.pravoId });
}

export async function findAct(db: SystemDb, pravoId: string): Promise<ActRow | undefined> {
  const rows = await db.select(ACT_COLUMNS).from(legalActs).where(eq(legalActs.pravoId, pravoId));
  const row = rows[0];
  return row === undefined ? undefined : asRow(row);
}

/** ID актов стартового каталога, которые ещё надо загрузить (ждут, ошибка, карантин): порядок — как в каталоге. */
export async function actsToLoad(db: SystemDb, source: ActSource): Promise<readonly string[]> {
  const rows = await db
    .select({ pravoId: legalActs.pravoId })
    .from(legalActs)
    .where(
      and(
        eq(legalActs.source, source),
        eq(legalActs.hasText, true),
        inArray(legalActs.loadState, ["pending", "failed"]),
      ),
    )
    .orderBy(legalActs.createdAt, legalActs.pravoId);
  return rows.map((r) => r.pravoId);
}

export interface CatalogCounts {
  readonly total: number;
  readonly loaded: number;
  readonly problems: number;
}

/** Сколько актов источника всего, загружено (текст или карточка) и с проблемой (карантин, ошибка). */
export async function countActs(db: SystemDb, source: ActSource): Promise<CatalogCounts> {
  const rows = await db
    .select({ state: legalActs.loadState, n: count() })
    .from(legalActs)
    .where(eq(legalActs.source, source))
    .groupBy(legalActs.loadState);
  let total = 0;
  let loaded = 0;
  let problems = 0;
  for (const row of rows) {
    total += row.n;
    if (row.state === "loaded" || row.state === "card-only") loaded += row.n;
    if (row.state === "quarantined" || row.state === "failed") problems += row.n;
  }
  return { total, loaded, problems };
}

/** Хэш последнего применённого снимка. */
export async function appliedHash(db: SystemDb, actId: string): Promise<string | undefined> {
  const rows = await db
    .select({ hash: legalActSnapshots.textHash })
    .from(legalActs)
    .innerJoin(legalActSnapshots, eq(legalActSnapshots.id, legalActs.currentSnapshotId))
    .where(eq(legalActs.id, actId));
  return rows[0]?.hash;
}

/** Ключи путей действующих версий фрагментов — для проверки «пропало больше 5%» (LAW-39). */
export async function currentPaths(db: SystemDb, actId: string): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ path: legalFragments.pathKey })
    .from(legalFragments)
    .innerJoin(legalFragmentVersions, eq(legalFragmentVersions.fragmentId, legalFragments.id))
    .where(and(eq(legalFragments.actId, actId), eq(legalFragmentVersions.isCurrent, true)));
  return new Set(rows.map((r) => r.path));
}

export interface SnapshotInput {
  readonly actId: string;
  readonly textHash: string;
  readonly rawGz: Buffer;
  readonly rawBytes: number;
  readonly fetchedAt: Date;
}

function fragmentIdOf(byPath: ReadonlyMap<string, string>, pathKey: string): string {
  const id = byPath.get(pathKey);
  if (id === undefined) throw new Error("legal_fragments: id вставленного фрагмента не вернулся.");
  return id;
}

/** Первая загрузка: снимок «применён», фрагменты и их версии, акт — «загружен». Одна транзакция. */
export async function applyFirstSnapshot(
  db: SystemDb,
  snapshot: SnapshotInput,
  fragments: readonly ParsedFragment[],
  articleCount: number,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(legalActSnapshots)
      .values({ ...snapshot, status: "applied" })
      .returning({ id: legalActSnapshots.id });
    if (saved === undefined) throw new Error("legal_act_snapshots: снимок не сохранился.");
    const BATCH = 500;
    for (let i = 0; i < fragments.length; i += BATCH) {
      const part = fragments.slice(i, i + BATCH);
      const ids = await tx
        .insert(legalFragments)
        .values(
          part.map((f) => ({
            actId: snapshot.actId,
            pathKey: f.pathKey,
            articleNo: f.articleNo,
            position: f.position,
          })),
        )
        .returning({ id: legalFragments.id, pathKey: legalFragments.pathKey });
      const byPath = new Map(ids.map((r) => [r.pathKey, r.id]));
      await tx.insert(legalFragmentVersions).values(
        part.map((f) => ({
          fragmentId: fragmentIdOf(byPath, f.pathKey),
          kind: f.kind,
          searchPath: f.searchPath,
          heading: f.heading,
          body: f.body,
          textHash: f.textHash,
          excluded: f.excluded,
          isCurrent: true,
          firstSnapshotId: saved.id,
          lastSnapshotId: saved.id,
        })),
      );
    }
    await tx
      .update(legalActs)
      .set({
        loadState: "loaded",
        currentSnapshotId: saved.id,
        articleCount,
        loadedAt: snapshot.fetchedAt,
        lastProblem: null,
      })
      .where(eq(legalActs.id, snapshot.actId));
    return saved.id;
  });
}

/**
 * Снимок, который не применяется: карантин (LAW-39: действующая редакция остаётся) или изменённая страница, версии
 * которой сопоставит T-036 (`pending`). Тот же хэш повторно не сохраняется.
 */
export async function storeUnappliedSnapshot(
  db: SystemDb,
  snapshot: SnapshotInput,
  status: "quarantined" | "pending",
  reason: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(legalActSnapshots)
      .values({ ...snapshot, status, reason })
      .onConflictDoNothing({ target: [legalActSnapshots.actId, legalActSnapshots.textHash] });
    if (status === "quarantined") {
      await tx
        .update(legalActs)
        .set({ loadState: "quarantined", lastProblem: reason })
        .where(eq(legalActs.id, snapshot.actId));
    }
  });
}

export async function markActState(
  db: SystemDb,
  actId: string,
  patch: { loadState: ActLoadState; lastProblem: string | null; hasText?: boolean },
): Promise<void> {
  await db.update(legalActs).set(patch).where(eq(legalActs.id, actId));
}

/** Строка журнала обновлений (LAW-40): событие-код и числа, без текста страниц. */
export async function logUpdate(
  db: SystemDb,
  entry: {
    at: Date;
    actId: string | null;
    event: string;
    details?: Record<string, string | number>;
  },
): Promise<void> {
  await db.insert(legalUpdateLog).values({
    at: entry.at,
    actId: entry.actId,
    event: entry.event,
    details: entry.details ?? {},
  });
}
