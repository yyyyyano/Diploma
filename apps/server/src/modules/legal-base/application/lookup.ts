// Фрагмент по id и карточка акта (LAW-07, LEGAL-05): чтение для инструментов агента и соседей.
import type { SystemDb } from "../../../platform/db/system-db.ts";
import {
  citationRows,
  firstEditionAt,
  type CitationRow,
} from "../infrastructure/db/citations.repo.ts";
import {
  actCardRow,
  fragmentsByVersionIds,
  fragmentsUnderPath,
} from "../infrastructure/db/search.repo.ts";

/** Версия фрагмента для цитаты (LEGAL-03, LEGAL-05): текст, путь, состояние версии и акта, день редакции, ссылка на pravo.by. */
export interface CitationSource extends Omit<CitationRow, "editionAt"> {
  /** День редакции «ГГГГ-ММ-ДД» (UTC-день снимка, как в «Базе законов»); нет снимка — null. */
  readonly editionOn: string | null;
  readonly url: string;
}

// Тот же день, что показывает «База законов» (reader.ts): UTC-день снимка.
const isoDay = (at: Date | null): string | null =>
  at === null ? null : at.toISOString().slice(0, 10);

export function makeLookup(d: { readonly system: SystemDb }) {
  return {
    /** Фрагмент действующей версии (или любой версии по id — цитата в ответе ссылается на версию, CHAT-10). */
    fragment: async (versionId: string) => (await fragmentsByVersionIds(d.system, [versionId]))[0],
    actCard: (pravoId: string) => actCardRow(d.system, pravoId),
    /** Версии фрагментов по id для цитат (любые, не только действующие); неизвестный id пропускается, порядок — как в списке. */
    citations: async (versionIds: readonly string[]): Promise<readonly CitationSource[]> =>
      (await citationRows(d.system, versionIds)).map(({ editionAt, ...row }) => ({
        ...row,
        editionOn: isoDay(editionAt),
        url: `https://pravo.by/document/?guid=${row.hasText ? "3871" : "3961"}&p0=${row.pravoId}`,
      })),
    /** День первой применённой редакции акта в базе (LEGAL-08): раньше — прежней редакции нет; снимков нет — null. */
    firstEditionOn: async (pravoId: string) => isoDay(await firstEditionAt(d.system, pravoId)),
    /** Текст пункта и вложенных частей действующей редакции (LAW-33: сверка чисел ставок); акта или текста нет — пусто. */
    fragmentsUnder: (pravoId: string, pathKey: string) =>
      fragmentsUnderPath(d.system, pravoId, pathKey),
  };
}

export type Lookup = ReturnType<typeof makeLookup>;
