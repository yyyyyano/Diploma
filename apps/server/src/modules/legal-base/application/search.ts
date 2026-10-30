// Поиск по законам (LAW-21, LAW-22, LAW-23): 1) точное обращение «ст. 210 НК» по таблице кратких имён — без векторов;
// 2) гибрид «полнотекстовый + векторный» с RRF, словарём «бытовое → юридическое»; 3) расширение выдачи статьями, на
// которые сослались найденные фрагменты, и определениями актов — в пределах 6–10 фрагментов. Без модели эмбеддингов
// (не запущена, самотест не прошёл) поиск идёт по реквизитам и полнотекстовому индексу без ошибки (LAW-10).
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import { parseReference } from "../domain/reference.ts";
import { buildTsQuery } from "../domain/ts-query.ts";
import { findAct } from "../infrastructure/db/catalog.repo.ts";
import {
  actCardRow,
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

/** Карточка акта со ссылкой: акт назван, но текста в базе нет или он не успел загрузиться (LEGAL-06, LAW-09). */
export interface NamedAct {
  readonly pravoId: string;
  readonly title: string;
  readonly hasText: boolean;
  readonly url: string;
}

export interface SearchOutcome {
  readonly mode: "exact" | "hybrid";
  /** Акт загружен по этому вопросу только что (LAW-09): ответ с пометкой «акт добавлен в базу только что». */
  readonly justAdded: boolean;
  /** Названные акты без фрагментов: карточка со ссылкой на pravo.by. */
  readonly cards: readonly NamedAct[];
  /** Были ли использованы векторы (нет модели — false, LAW-10). */
  readonly vectors: boolean;
  readonly fragments: readonly LawFragment[];
}

export interface LawSearchDeps {
  readonly system: SystemDb;
  /** Вектор запроса локальной моделью; null/ошибка — модель недоступна. */
  /** Догрузка акта по требованию (LAW-09); нет — только то, что уже в базе. */
  readonly demand?: (s: ScopedDb, pravoId: string) => Promise<"loaded" | "timeout" | "limit">;
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
  async function exact(query: string, s?: ScopedDb): Promise<SearchOutcome | null> {
    const ref = parseReference(query);
    if (ref === null) return null;
    const cards: NamedAct[] = [];
    // «НК» — два акта (Общая и Особенная части): берём тот, где есть такая статья.
    for (const act of await actsByAlias(d.system, ref.actAlias)) {
      let rows = await articleFragments(d.system, act.id, ref.articleNo, ref.point);
      let justAdded = false;
      if (rows.length === 0) {
        const card = await actCardRow(d.system, act.pravoId);
        if (card === undefined) continue;
        const named: NamedAct = {
          pravoId: card.pravoId,
          title: card.title,
          hasText: card.hasText,
          url: `https://pravo.by/document/?guid=${card.hasText ? "3871" : "3961"}&p0=${card.pravoId}`,
        };
        if (
          card.hasText &&
          card.loadState !== "loaded" &&
          s !== undefined &&
          d.demand !== undefined
        ) {
          // LAW-09: акт каталога с текстом, но без индекса — догружаем (worker) и ждём не дольше настройки.
          if ((await d.demand(s, act.pravoId)) === "loaded") {
            rows = await articleFragments(d.system, act.id, ref.articleNo, ref.point);
            justAdded = rows.length > 0;
          } else {
            // Не дождались (или предел в сутки): карточка со ссылкой вместо текста.
            cards.push(named);
          }
        }
        if (rows.length === 0) continue;
        return { mode: "exact", justAdded, cards: [], vectors: false, fragments: withUrl(rows) };
      }
      return { mode: "exact", justAdded, cards: [], vectors: false, fragments: withUrl(rows) };
    }
    return cards.length === 0
      ? null
      : { mode: "exact", justAdded: false, cards, vectors: false, fragments: [] };
  }

  async function search(
    query: string,
    opts: { limit?: number; s?: ScopedDb } = {},
  ): Promise<SearchOutcome> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const found = await exact(query, opts.s);
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
    return {
      mode: "hybrid",
      justAdded: false,
      cards: [],
      vectors: vector !== null,
      fragments: withUrl(rows.slice(0, cap)),
    };
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
