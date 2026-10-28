// Запросы к фактам профиля, их ревизиям и признаку анкеты: первый аргумент — s: ScopedDb, у каждого обращения свой
// s.own (ADR-0006). Строку, которую меняет действие, читаем FOR UPDATE: два одновременных изменения одного факта
// идут по очереди, и ревизия «до действия» верна.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { profileFactRevisions, profileFacts, profiles } from "./schema.ts";

/** Состояние факта, которое помнит ревизия и восстанавливает «Отменить». */
export interface FactState {
  readonly value: unknown;
  readonly source: string;
  readonly sourceRef: string | null;
  readonly status: string;
  readonly recordedOn: string;
  readonly deletedAt: Date | null;
}

export interface FactRow extends FactState {
  readonly id: string;
  readonly key: string;
  readonly topic: string;
}

const factColumns = {
  id: profileFacts.id,
  key: profileFacts.key,
  topic: profileFacts.topic,
  value: profileFacts.value,
  source: profileFacts.source,
  sourceRef: profileFacts.sourceRef,
  status: profileFacts.status,
  recordedOn: profileFacts.recordedOn,
  deletedAt: profileFacts.deletedAt,
};

/** Действующие (не удалённые) факты; keys — только эти ключи. Порядок — по созданию, последний ключ — id. */
export async function listLiveFacts(s: ScopedDb, keys?: readonly string[]): Promise<FactRow[]> {
  return s.db
    .select(factColumns)
    .from(profileFacts)
    .where(
      and(
        s.own(profileFacts),
        isNull(profileFacts.deletedAt),
        keys === undefined ? undefined : inArray(profileFacts.key, [...keys]),
      ),
    )
    .orderBy(asc(profileFacts.createdAt), asc(profileFacts.id));
}

/** Факт по id (и удалённый) под блокировкой строки; чужой и неизвестный — undefined. */
export async function lockFact(s: ScopedDb, id: string): Promise<FactRow | undefined> {
  const rows = await s.db
    .select(factColumns)
    .from(profileFacts)
    .where(and(s.own(profileFacts), eq(profileFacts.id, id)))
    .for("update");
  return rows[0];
}

/** Факт ключа PROF-01 (и удалённый — строка ключа одна) под блокировкой. */
export async function lockFactByKey(s: ScopedDb, key: string): Promise<FactRow | undefined> {
  const rows = await s.db
    .select(factColumns)
    .from(profileFacts)
    .where(
      and(s.own(profileFacts), eq(profileFacts.userId, s.scope.userId), eq(profileFacts.key, key)),
    )
    .for("update");
  return rows[0];
}

export interface NewFact extends Omit<FactState, "deletedAt"> {
  readonly key: string;
  readonly topic: string;
}

/**
 * Новый факт. Ключ PROF-01 уже есть (параллельная запись) — ничего не вставляется: undefined, вызывающий читает
 * строку ключа и правит её.
 */
export async function insertFact(s: ScopedDb, fact: NewFact): Promise<string | undefined> {
  const query = s.insert(profileFacts).values(fact);
  const rows = await (
    fact.key === "note"
      ? query
      : query.onConflictDoNothing({
          target: [profileFacts.householdId, profileFacts.userId, profileFacts.key],
          where: sql`${profileFacts.key} <> 'note'`,
        })
  ).returning({ id: profileFacts.id });
  return rows[0]?.id;
}

export async function updateFact(
  s: ScopedDb,
  id: string,
  patch: Partial<FactState & { topic: string }>,
  at: Date,
): Promise<void> {
  await s.update(profileFacts, eq(profileFacts.id, id)).set({ ...patch, updatedAt: at });
}

/** Ревизия «состояние до действия»; existed = false — факта до действия не было. */
export async function insertRevision(
  s: ScopedDb,
  factId: string,
  state: FactState & { readonly existed: boolean },
): Promise<string> {
  const rows = await s
    .insert(profileFactRevisions)
    .values({ factId, ...state })
    .returning({ id: profileFactRevisions.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("profile_fact_revisions: вставка не вернула id.");
  return id;
}

export async function findRevision(
  s: ScopedDb,
  id: string,
): Promise<(FactState & { readonly factId: string; readonly existed: boolean }) | undefined> {
  const rows = await s.db
    .select({
      factId: profileFactRevisions.factId,
      existed: profileFactRevisions.existed,
      value: profileFactRevisions.value,
      source: profileFactRevisions.source,
      sourceRef: profileFactRevisions.sourceRef,
      status: profileFactRevisions.status,
      recordedOn: profileFactRevisions.recordedOn,
      deletedAt: profileFactRevisions.deletedAt,
    })
    .from(profileFactRevisions)
    .where(and(s.own(profileFactRevisions), eq(profileFactRevisions.id, id)));
  return rows[0];
}

/** AUTH-07: анкету прошли или пропустили — отметка один раз (повтор ничего не меняет). */
export async function markOnboardingDone(s: ScopedDb, at: Date): Promise<void> {
  await s
    .insert(profiles)
    .values({ onboardingDoneAt: at })
    .onConflictDoNothing({ target: [profiles.householdId, profiles.userId] });
}

export async function onboardingDone(s: ScopedDb): Promise<boolean> {
  const rows = await s.db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        s.own(profiles),
        eq(profiles.userId, s.scope.userId),
        sql`${profiles.onboardingDoneAt} is not null`,
      ),
    );
  return rows.length > 0;
}
