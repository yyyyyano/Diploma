// Фрагмент по id и карточка акта (LAW-07, LEGAL-05): чтение для инструментов агента и соседей.
import type { SystemDb } from "../../../platform/db/system-db.ts";
import {
  actCardRow,
  fragmentsByVersionIds,
  fragmentsUnderPath,
} from "../infrastructure/db/search.repo.ts";

export function makeLookup(d: { readonly system: SystemDb }) {
  return {
    /** Фрагмент действующей версии (или любой версии по id — цитата в ответе ссылается на версию, CHAT-10). */
    fragment: async (versionId: string) => (await fragmentsByVersionIds(d.system, [versionId]))[0],
    actCard: (pravoId: string) => actCardRow(d.system, pravoId),
    /** Текст пункта и вложенных частей действующей редакции (LAW-33: сверка чисел ставок); акта или текста нет — пусто. */
    fragmentsUnder: (pravoId: string, pathKey: string) =>
      fragmentsUnderPath(d.system, pravoId, pathKey),
  };
}

export type Lookup = ReturnType<typeof makeLookup>;
