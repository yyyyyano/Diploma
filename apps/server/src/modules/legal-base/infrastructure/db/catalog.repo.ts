// Каталог актов, снимки и фрагменты (LAW-07, LAW-20, LAW-39) — только через SystemDb модуля legal-base. Запись снимка и
// фрагментов — одна транзакция, без сети внутри: страницу читают до неё.
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type { ParsedFragment } from "../../domain/build-fragments.ts";
import type { CurrentVersion, EditionPlan } from "../../domain/match-versions.ts";
import type { CatalogEntry } from "../../domain/start-catalog.ts";
import { aliasesOf } from "../../domain/aliases.ts";
import { isNpa } from "../../domain/start-catalog.ts";
import {
  legalActAliases,
  legalActSnapshots,
  legalActs,
  legalFragmentEmbeddings,
  legalFragmentVersions,
  legalFragments,
  legalUpdateLog,
  type ActLoadState,
  type ActSource,
} from "./schema.ts";
import { one } from "./rows.ts";

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

export interface SnapshotInput {
  readonly actId: string;
  readonly textHash: string;
  readonly rawGz: Buffer;
  readonly rawBytes: number;
  readonly fetchedAt: Date;
}

function fragmentIdOf(byPath: ReadonlyMap<string, string>, pathKey: string): string {
  return one(
    [byPath.get(pathKey)].flatMap((id) => (id === undefined ? [] : [id])),
    "legal_fragments",
  );
}

/** Первая загрузка: снимок «применён», фрагменты и их версии, акт — «загружен». Одна транзакция. */
export async function applyFirstSnapshot(
  db: SystemDb,
  snapshot: SnapshotInput,
  fragments: readonly ParsedFragment[],
  articleCount: number,
): Promise<string> {
  return db.transaction(async (tx) => {
    const saved = one(
      await tx
        .insert(legalActSnapshots)
        .values({ ...snapshot, status: "applied" })
        .returning({ id: legalActSnapshots.id }),
      "legal_act_snapshots",
    );
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

/** Снимок в карантине (LAW-39): действующая редакция остаётся, акт получает состояние «карантин»; тот же хэш повторно не хранится. */
export async function storeQuarantinedSnapshot(
  db: SystemDb,
  snapshot: SnapshotInput,
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(legalActSnapshots)
      .values({ ...snapshot, status: "quarantined", reason })
      .onConflictDoNothing({ target: [legalActSnapshots.actId, legalActSnapshots.textHash] });
    await tx
      .update(legalActs)
      .set({ loadState: "quarantined", lastProblem: reason })
      .where(eq(legalActs.id, snapshot.actId));
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

/** Краткие имена актов каталога (LAW-21): начальный набор для известных актов; повтор безопасен. */
export async function seedAliases(db: SystemDb, entries: readonly CatalogEntry[]): Promise<void> {
  const acts = await db.select({ id: legalActs.id, pravoId: legalActs.pravoId }).from(legalActs);
  const idOf = new Map(acts.map((a) => [a.pravoId, a.id]));
  const values = entries.flatMap((e) =>
    aliasesOf(e.pravoId).flatMap((alias) => {
      const actId = idOf.get(e.pravoId);
      return actId === undefined ? [] : [{ actId, alias }];
    }),
  );
  if (values.length === 0) return;
  await db.insert(legalActAliases).values(values).onConflictDoNothing();
}

/** Действующие версии фрагментов акта — для сопоставления с новой редакцией (LAW-31). */
export async function currentVersions(db: SystemDb, actId: string): Promise<CurrentVersion[]> {
  return db
    .select({
      fragmentId: legalFragments.id,
      versionId: legalFragmentVersions.id,
      pathKey: legalFragments.pathKey,
      textHash: legalFragmentVersions.textHash,
      excluded: legalFragmentVersions.excluded,
    })
    .from(legalFragments)
    .innerJoin(legalFragmentVersions, eq(legalFragmentVersions.fragmentId, legalFragments.id))
    .where(and(eq(legalFragments.actId, actId), eq(legalFragmentVersions.isCurrent, true)));
}

export interface EditionResult {
  readonly kept: number;
  readonly changed: number;
  readonly renumbered: number;
  readonly added: number;
  readonly excluded: number;
}

/**
 * Применить новую редакцию (LAW-31) одной транзакцией: версии неизменённых продлеваются, изменённые — закрываются и
 * открываются заново (вектор закрытой версии удаляется: векторы только у текущих), перенумерованные получают новый ключ,
 * добавленные — новые фрагменты, пропавшие — версию «исключён» с прежним текстом. Векторизует новые версии отдельная задача.
 */
export async function applyEdition(
  db: SystemDb,
  snapshot: SnapshotInput,
  plan: EditionPlan,
  articleCount: number,
): Promise<EditionResult> {
  return db.transaction(async (tx) => {
    const saved = one(
      await tx
        .insert(legalActSnapshots)
        .values({ ...snapshot, status: "applied" })
        .onConflictDoUpdate({
          target: [legalActSnapshots.actId, legalActSnapshots.textHash],
          set: { status: "applied", reason: null },
        })
        .returning({ id: legalActSnapshots.id }),
      "legal_act_snapshots",
    );
    const snap = saved.id;
    const close = async (versionIds: string[]) => {
      if (versionIds.length === 0) return;
      await tx
        .update(legalFragmentVersions)
        .set({ isCurrent: false })
        .where(inArray(legalFragmentVersions.id, versionIds));
      await tx
        .delete(legalFragmentEmbeddings)
        .where(inArray(legalFragmentEmbeddings.versionId, versionIds));
    };
    const open = (
      fragmentId: string,
      f: Pick<ParsedFragment, "searchPath" | "heading" | "body" | "textHash" | "excluded"> & {
        kind: string;
      },
    ) =>
      tx.insert(legalFragmentVersions).values({
        fragmentId,
        kind: f.kind,
        searchPath: f.searchPath,
        heading: f.heading,
        body: f.body,
        textHash: f.textHash,
        excluded: f.excluded,
        isCurrent: true,
        firstSnapshotId: snap,
        lastSnapshotId: snap,
      });
    // Продлить: текст и путь те же.
    const keepIds = plan.keep.map((m) => m.current.versionId);
    if (keepIds.length > 0) {
      await tx
        .update(legalFragmentVersions)
        .set({ lastSnapshotId: snap })
        .where(inArray(legalFragmentVersions.id, keepIds));
    }
    // Заменить и перенести: старая версия закрывается раньше, чем открывается новая (одна текущая на фрагмент).
    await close([...plan.changed, ...plan.renumbered].map((m) => m.current.versionId));
    // Перенумерация без конфликта ключей при сдвигах (a5→a6, a6→a7): сначала временные ключи.
    for (const m of plan.renumbered) {
      await tx
        .update(legalFragments)
        .set({ pathKey: sql`'~' || ${m.current.fragmentId}::text` })
        .where(eq(legalFragments.id, m.current.fragmentId));
    }
    for (const m of [...plan.changed, ...plan.renumbered]) {
      await tx
        .update(legalFragments)
        .set({ pathKey: m.next.pathKey, articleNo: m.next.articleNo, position: m.next.position })
        .where(eq(legalFragments.id, m.current.fragmentId));
      await open(m.current.fragmentId, m.next);
    }
    for (const f of plan.added) {
      const fragment = one(
        await tx
          .insert(legalFragments)
          .values({
            actId: snapshot.actId,
            pathKey: f.pathKey,
            articleNo: f.articleNo,
            position: f.position,
          })
          .returning({ id: legalFragments.id }),
        "legal_fragments",
      );
      await open(fragment.id, f);
    }
    // Пропавшие: версия «исключён» с прежним текстом — честный ответ «ст. N исключена».
    await close(plan.missing.map((c) => c.versionId));
    for (const c of plan.missing) {
      const old = await tx
        .select({
          kind: legalFragmentVersions.kind,
          searchPath: legalFragmentVersions.searchPath,
          heading: legalFragmentVersions.heading,
          body: legalFragmentVersions.body,
          textHash: legalFragmentVersions.textHash,
        })
        .from(legalFragmentVersions)
        .where(eq(legalFragmentVersions.id, c.versionId));
      await open(c.fragmentId, { ...one(old, "legal_fragment_versions"), excluded: true });
    }
    await tx
      .update(legalActs)
      .set({
        loadState: "loaded",
        currentSnapshotId: snap,
        articleCount,
        loadedAt: snapshot.fetchedAt,
        lastProblem: null,
      })
      .where(eq(legalActs.id, snapshot.actId));
    return {
      kept: plan.keep.length,
      changed: plan.changed.length,
      renumbered: plan.renumbered.length,
      added: plan.added.length,
      excluded: plan.missing.length,
    };
  });
}

/** Акты с текстом, которые проверяет ежедневный проход: загруженные, на карантине и с ошибкой (LAW-30). */
export async function checkableActs(db: SystemDb): Promise<{ id: string; pravoId: string }[]> {
  return db
    .select({ id: legalActs.id, pravoId: legalActs.pravoId })
    .from(legalActs)
    .where(
      and(
        eq(legalActs.hasText, true),
        eq(legalActs.status, "active"),
        inArray(legalActs.loadState, ["loaded", "quarantined", "failed"]),
      ),
    )
    .orderBy(legalActs.pravoId);
}
