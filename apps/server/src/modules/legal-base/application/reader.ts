// «База законов» для всех (LEGAL-11, LEGAL-05, LEGAL-06, LAW-07, LAW-32): каталог, акт с оглавлением, часть текста и разбор
// обращения «ст. 210 НК». Публичное чтение общей базы — пользовательских данных здесь нет. Текст отдаётся частями (статья или
// страница акта без статей): НК целиком одним ответом не уходит.
import type { LawActView, LawCatalog, LawFragmentView, LawListItem } from "@kosht/contract";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { parseReference } from "../domain/reference.ts";
import { START_CATALOG } from "../domain/start-catalog.ts";
import { findAct } from "../infrastructure/db/catalog.repo.ts";
import { pendingChangesOf } from "../infrastructure/db/changes.repo.ts";
import {
  articleText,
  articleToc,
  catalogRows,
  currentFetchedAt,
  looseFragmentCount,
  loosePage,
  type CatalogRow,
} from "../infrastructure/db/reader.repo.ts";
import { actsByAlias, articleFragments, actCardRow } from "../infrastructure/db/search.repo.ts";

/** Фрагментов на странице акта без статей. */
export const PAGE_SIZE = 40;
const SHORT_NAMES = new Map(START_CATALOG.map((e) => [e.pravoId, e.label]));
const GROUPS = new Set([
  "taxes",
  "consumer",
  "housing",
  "banking",
  "work",
  "benefits",
  "contracts",
  "education-health",
  "family",
  "fines",
  "privacy",
]);

const isoDay = (at: Date | null): string | null =>
  at === null ? null : at.toISOString().slice(0, 10);
const url = (pravoId: string, guid: 3871 | 3961) =>
  `https://pravo.by/document/?guid=${String(guid)}&p0=${pravoId}`;

function itemOf(r: CatalogRow): LawListItem {
  const status =
    r.status === "repealed"
      ? "repealed"
      : !r.hasText
        ? "card-only"
        : r.pending > 0
          ? "has-changes"
          : "active";
  return {
    pravoId: r.pravoId,
    title: r.title,
    kind: r.kind,
    shortName: SHORT_NAMES.get(r.pravoId) ?? null,
    status,
    repealedOn: r.repealedOn,
    editionOn: isoDay(r.editionAt),
    // Разъяснения Пленума — отдельная группа по виду акта (LAW-04), прочие — по теме; акт без темы в витрину без группы.
    group:
      r.kind === "plenum"
        ? "plenum"
        : r.topic !== null && GROUPS.has(r.topic)
          ? (r.topic as LawListItem["group"])
          : null,
    isNpa: r.isNpa,
    hasText: r.hasText,
  };
}

export function makeReader(d: { readonly system: SystemDb }) {
  async function catalog(): Promise<LawCatalog> {
    const rows = await catalogRows(d.system);
    const acts = rows.map(itemOf);
    const editions = rows.flatMap((r) => (r.editionAt === null ? [] : [r.editionAt.getTime()]));
    return {
      acts,
      counts: {
        total: acts.length,
        withText: acts.filter((a) => a.hasText).length,
        cardOnly: acts.filter((a) => !a.hasText).length,
        withChanges: acts.filter((a) => a.status === "has-changes").length,
      },
      editionOn: editions.length === 0 ? null : isoDay(new Date(Math.max(...editions))),
    };
  }

  async function act(pravoId: string): Promise<LawActView> {
    const act = await findAct(d.system, pravoId);
    const row = (await catalogRows(d.system)).find((r) => r.pravoId === pravoId);
    if (act === undefined || row === undefined) throw new AppError("NOT_FOUND");
    const toc: LawActView["toc"] = [];
    if (act.hasText && act.loadState !== "pending") {
      const articles = await articleToc(d.system, act.id);
      for (const a of articles) {
        const segments = a.searchPath.split(" › ");
        toc.push({
          key: a.articleNo,
          kind: "article",
          number: a.articleNo.replace(".", "¹"),
          heading: a.heading,
          // Между названием акта и «Статья N»: раздел, глава.
          group: segments.slice(1, -1),
        });
      }
      if (articles.length === 0) {
        const pages = Math.ceil((await looseFragmentCount(d.system, act.id)) / PAGE_SIZE);
        for (let page = 1; page <= pages; page += 1) {
          toc.push({
            key: `p:${String(page)}`,
            kind: "page",
            number: String(page),
            heading: null,
            group: [],
          });
        }
      }
    }
    return {
      act: itemOf(row),
      fetchedAt: (await currentFetchedAt(d.system, act.id))?.toISOString() ?? null,
      url: url(pravoId, 3871),
      cardUrl: url(pravoId, 3961),
      toc,
      pending: (await pendingChangesOf(d.system, act.id)).map((c) => ({
        description: c.description,
        inForceOn: c.inForceOn,
        articles: [...c.articles],
      })),
    };
  }

  async function fragments(pravoId: string, key: string): Promise<LawFragmentView[]> {
    const act = await findAct(d.system, pravoId);
    if (act === undefined) throw new AppError("NOT_FOUND");
    const rows = key.startsWith("p:")
      ? await loosePage(d.system, act.id, Number(key.slice(2)), PAGE_SIZE)
      : await articleText(d.system, act.id, key);
    if (rows.length === 0) throw new AppError("NOT_FOUND");
    return rows.map((r) => ({ ...r }));
  }

  /** «ст. 210 НК» → акт и статья (у «НК» два акта — берётся тот, где есть статья); иначе null. */
  async function resolve(q: string): Promise<{ pravoId: string; key: string } | null> {
    const ref = parseReference(q);
    if (ref === null) return null;
    for (const candidate of await actsByAlias(d.system, ref.actAlias)) {
      if ((await articleFragments(d.system, candidate.id, ref.articleNo, null)).length > 0) {
        return { pravoId: candidate.pravoId, key: ref.articleNo };
      }
    }
    return null;
  }

  return {
    catalog,
    act,
    fragments,
    resolve,
    card: (pravoId: string) => actCardRow(d.system, pravoId),
  };
}

export type Reader = ReturnType<typeof makeReader>;
