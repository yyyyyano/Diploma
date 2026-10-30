// Справочники администратора в таблицах (LAW-40): стартовый каталог, органы, «бытовое → юридическое» — свои таблицы; краткие имена —
// `legal_act_aliases`. Запись — по естественному ключу; правка ключа — перенос строки в одной транзакции.
import { and, asc, count, eq, max } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type { CatalogEntry, ActKind } from "../../domain/start-catalog.ts";
import type { OrganTopic, Topic } from "../../domain/topics.ts";
import {
  legalActAliases,
  legalActs,
  legalColloquialTerms,
  legalOrganTopics,
  legalStartCatalog,
} from "./schema.ts";

/** Стартовый каталог: строки по порядку. */
export async function startCatalogEntries(db: SystemDb): Promise<CatalogEntry[]> {
  const rows = await db.select().from(legalStartCatalog).orderBy(asc(legalStartCatalog.position));
  return rows.map((r) => ({
    pravoId: r.pravoId,
    title: r.title,
    label: r.label,
    kind: r.kind as ActKind,
    hasText: r.hasText,
    group: r.topicGroup,
  }));
}

/** Краткие названия актов стартового каталога для пути поиска и читалки: ID → «НК (Особенная часть)». */
export async function startCatalogLabels(db: SystemDb): Promise<Map<string, string>> {
  const rows = await db
    .select({ pravoId: legalStartCatalog.pravoId, label: legalStartCatalog.label })
    .from(legalStartCatalog);
  return new Map(rows.map((r) => [r.pravoId, r.label]));
}

export async function saveStartCatalogEntry(
  db: SystemDb,
  entry: CatalogEntry,
  previousId: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const previous =
      previousId === null
        ? undefined
        : (
            await tx
              .select({ position: legalStartCatalog.position })
              .from(legalStartCatalog)
              .where(eq(legalStartCatalog.pravoId, previousId))
          )[0];
    const position =
      previous?.position ??
      ((await tx.select({ n: max(legalStartCatalog.position) }).from(legalStartCatalog))[0]?.n ??
        0) + 1;
    if (previousId !== null && previousId !== entry.pravoId) {
      await tx.delete(legalStartCatalog).where(eq(legalStartCatalog.pravoId, previousId));
    }
    const values = {
      title: entry.title,
      label: entry.label,
      kind: entry.kind,
      hasText: entry.hasText,
      topicGroup: entry.group,
    };
    await tx
      .insert(legalStartCatalog)
      .values({ pravoId: entry.pravoId, position, ...values })
      .onConflictDoUpdate({ target: legalStartCatalog.pravoId, set: values });
  });
}

export async function removeStartCatalogEntry(db: SystemDb, pravoId: string): Promise<boolean> {
  const rows = await db
    .delete(legalStartCatalog)
    .where(eq(legalStartCatalog.pravoId, pravoId))
    .returning({ id: legalStartCatalog.pravoId });
  return rows.length > 0;
}

/** «Свои» органы: по порядку (первое совпадение выигрывает). */
export async function organTopics(db: SystemDb): Promise<OrganTopic[]> {
  const rows = await db.select().from(legalOrganTopics).orderBy(asc(legalOrganTopics.position));
  return rows.map((r) => ({ pattern: r.pattern, topic: r.topic as Topic }));
}

export async function saveOrgan(
  db: SystemDb,
  organ: OrganTopic,
  previousPattern: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const previous =
      previousPattern === null
        ? undefined
        : (
            await tx
              .select({ position: legalOrganTopics.position })
              .from(legalOrganTopics)
              .where(eq(legalOrganTopics.pattern, previousPattern))
          )[0];
    const position =
      previous?.position ??
      ((await tx.select({ n: max(legalOrganTopics.position) }).from(legalOrganTopics))[0]?.n ?? 0) +
        1;
    if (previousPattern !== null && previousPattern !== organ.pattern) {
      await tx.delete(legalOrganTopics).where(eq(legalOrganTopics.pattern, previousPattern));
    }
    await tx
      .insert(legalOrganTopics)
      .values({ pattern: organ.pattern, topic: organ.topic, position })
      .onConflictDoUpdate({ target: legalOrganTopics.pattern, set: { topic: organ.topic } });
  });
}

export async function removeOrgan(db: SystemDb, pattern: string): Promise<boolean> {
  const rows = await db
    .delete(legalOrganTopics)
    .where(eq(legalOrganTopics.pattern, pattern))
    .returning({ id: legalOrganTopics.pattern });
  return rows.length > 0;
}

/** Словарь «бытовое → юридическое»: слово → термины. */
export async function colloquialTerms(db: SystemDb): Promise<Record<string, string[]>> {
  const rows = await db.select().from(legalColloquialTerms).orderBy(asc(legalColloquialTerms.word));
  return Object.fromEntries(rows.map((r) => [r.word, r.terms]));
}

export async function saveColloquial(
  db: SystemDb,
  word: string,
  terms: readonly string[],
  previousWord: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (previousWord !== null && previousWord !== word) {
      await tx.delete(legalColloquialTerms).where(eq(legalColloquialTerms.word, previousWord));
    }
    await tx
      .insert(legalColloquialTerms)
      .values({ word, terms: [...terms] })
      .onConflictDoUpdate({ target: legalColloquialTerms.word, set: { terms: [...terms] } });
  });
}

export async function removeColloquial(db: SystemDb, word: string): Promise<boolean> {
  const rows = await db
    .delete(legalColloquialTerms)
    .where(eq(legalColloquialTerms.word, word))
    .returning({ id: legalColloquialTerms.word });
  return rows.length > 0;
}

/** Краткие имена: строка на (акт, имя). */
export async function aliasRows(db: SystemDb): Promise<{ pravoId: string; alias: string }[]> {
  return db
    .select({ pravoId: legalActs.pravoId, alias: legalActAliases.alias })
    .from(legalActAliases)
    .innerJoin(legalActs, eq(legalActs.id, legalActAliases.actId))
    .orderBy(asc(legalActs.pravoId), asc(legalActAliases.alias));
}

/** Сохранить имя за актом; акта нет в каталоге — `false`. Правка ключа (акт или имя) — перенос строки. */
export async function saveAlias(
  db: SystemDb,
  next: { pravoId: string; alias: string },
  previous: { pravoId: string; alias: string } | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const act = (
      await tx
        .select({ id: legalActs.id })
        .from(legalActs)
        .where(eq(legalActs.pravoId, next.pravoId))
    )[0];
    if (act === undefined) return false;
    if (previous !== null) {
      const old = (
        await tx
          .select({ id: legalActs.id })
          .from(legalActs)
          .where(eq(legalActs.pravoId, previous.pravoId))
      )[0];
      if (old !== undefined) {
        await tx
          .delete(legalActAliases)
          .where(and(eq(legalActAliases.actId, old.id), eq(legalActAliases.alias, previous.alias)));
      }
    }
    await tx
      .insert(legalActAliases)
      .values({ actId: act.id, alias: next.alias })
      .onConflictDoNothing();
    return true;
  });
}

export async function removeAlias(
  db: SystemDb,
  key: { pravoId: string; alias: string },
): Promise<boolean> {
  const act = (
    await db.select({ id: legalActs.id }).from(legalActs).where(eq(legalActs.pravoId, key.pravoId))
  )[0];
  if (act === undefined) return false;
  const rows = await db
    .delete(legalActAliases)
    .where(and(eq(legalActAliases.actId, act.id), eq(legalActAliases.alias, key.alias)))
    .returning({ id: legalActAliases.id });
  return rows.length > 0;
}

/** Сколько всего краткие имена: пусто — первый запуск, имена по умолчанию заводятся. */
export async function aliasCount(db: SystemDb): Promise<number> {
  return (await db.select({ n: count() }).from(legalActAliases))[0]?.n ?? 0;
}
