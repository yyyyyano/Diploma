// Поиск по законам (LAW-21, LAW-22, LAW-23): 1) точное обращение «ст. 210 НК» по таблице кратких имён — без векторов;
// 2) гибрид «полнотекстовый + векторный» с RRF, словарём «бытовое → юридическое»; 3) расширение выдачи статьями, на
// которые сослались найденные фрагменты, и определениями актов — в пределах 6–10 фрагментов. Без модели эмбеддингов
// (не запущена, самотест не прошёл) поиск идёт по реквизитам и полнотекстовому индексу без ошибки (LAW-10).
import type { SystemDb } from "../../../platform/db/system-db.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import { parseReference } from "../domain/reference.ts";
import { buildTsQuery } from "../domain/ts-query.ts";
import { findAct } from "../infrastructure/db/catalog.repo.ts";
import {
  actsByAlias,
  articleFragments,
  definitionIds,
  fragmentsByVersionIds,
  hybridIds,
  type FragmentRow,
} from "../infrastructure/db/search.repo.ts";

/** В контекст модели идёт 6–10 компактных фрагментов (LAW-21): предел выдачи по умолчанию. */
export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 10;
/** Меньше найденного «И» — добавляем «ИЛИ». */
const MIN_AND_RESULTS = 6;

export interface LawFragment extends FragmentRow {
  /** Ссылка-первоисточник (LEGAL-03). */
  readonly url: string;
}

export interface SearchOutcome {
  readonly mode: "exact" | "hybrid";
  /** Были ли использованы векторы (нет модели — false, LAW-10). */
  readonly vectors: boolean;
  readonly fragments: readonly LawFragment[];
}

export interface LawSearchDeps {
  readonly system: SystemDb;
  /** Вектор запроса локальной моделью; null/ошибка — модель недоступна. */
  readonly embedQuery: (text: string) => Promise<readonly number[] | null>;
  readonly log: Logger;
}

const withUrl = (rows: readonly FragmentRow[]): LawFragment[] =>
  rows.map((r) => ({ ...r, url: `https://pravo.by/document/?guid=3871&p0=${r.pravoId}` }));

/** «в порядке, установленном статьёй 209», «статьями 12 и 13»: номера статей из текста найденных фрагментов. */
function referencedArticles(
  rows: readonly FragmentRow[],
): { pravoId: string; articleNo: string }[] {
  const out: { pravoId: string; articleNo: string }[] = [];
  for (const row of rows) {
    for (const m of row.text.matchAll(/стат(?:ь[яиюе]|ьёй|ьями)\s+(\d+(?:[¹²³]|\.\d+)?)/gu)) {
      const raw = m[1] ?? "";
      const no = raw.replace(/[¹²³]/u, (c) => `.${String("¹²³".indexOf(c) + 1)}`);
      if (no !== row.articleNo) out.push({ pravoId: row.pravoId, articleNo: no });
    }
  }
  return out;
}

export function makeLawSearch(d: LawSearchDeps) {
  async function exact(query: string): Promise<SearchOutcome | null> {
    const ref = parseReference(query);
    if (ref === null) return null;
    // «НК» — два акта (Общая и Особенная части): берём тот, где есть такая статья.
    for (const actId of await actsByAlias(d.system, ref.actAlias)) {
      const rows = await articleFragments(d.system, actId, ref.articleNo, ref.point);
      if (rows.length > 0) return { mode: "exact", vectors: false, fragments: withUrl(rows) };
    }
    return null;
  }

  async function search(query: string, limit = DEFAULT_LIMIT): Promise<SearchOutcome> {
    const found = await exact(query);
    if (found !== null) return found;
    const cap = Math.min(Math.max(limit, 1), MAX_LIMIT);
    let vector: readonly number[] | null = null;
    try {
      vector = await d.embedQuery(query);
    } catch {
      // Модель эмбеддингов недоступна — это не ошибка поиска (LAW-10): реквизиты и полнотекстовый индекс работают.
      vector = null;
    }
    if (vector === null) d.log.info({}, "law.search.no-vectors");
    const andQuery = buildTsQuery(query, "and");
    let ids = await hybridIds(d.system, { tsQuery: andQuery, vector, limit: cap });
    if (ids.length < Math.min(MIN_AND_RESULTS, cap)) {
      ids = await hybridIds(d.system, { tsQuery: buildTsQuery(query, "or"), vector, limit: cap });
    }
    let rows = [...(await fragmentsByVersionIds(d.system, ids))];
    // Расширение по ссылкам и определениям — в пределах предела выдачи.
    const extra: FragmentRow[] = [];
    for (const ref of referencedArticles(rows).slice(0, 3)) {
      const act = (await articleByPravoId(ref.pravoId, ref.articleNo))[0];
      if (act !== undefined) extra.push(act);
    }
    const defs = await fragmentsByVersionIds(
      d.system,
      await definitionIds(d.system, [...new Set(rows.slice(0, 3).map((r) => r.pravoId))]),
    );
    for (const row of [...extra, ...defs]) {
      if (rows.length >= cap) break;
      if (!rows.some((r) => r.versionId === row.versionId)) rows = [...rows, row];
    }
    return { mode: "hybrid", vectors: vector !== null, fragments: withUrl(rows.slice(0, cap)) };
  }

  async function articleByPravoId(
    pravoId: string,
    articleNo: string,
  ): Promise<readonly FragmentRow[]> {
    const act = await findAct(d.system, pravoId);
    return act === undefined ? [] : articleFragments(d.system, act.id, articleNo, null);
  }

  return { search, exact };
}

export type LawSearch = ReturnType<typeof makeLawSearch>;
