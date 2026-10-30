// Фрагмент по id и карточка акта (LAW-07, LEGAL-05): чтение для инструментов агента и соседей.
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { actCardRow, fragmentsByVersionIds } from "../infrastructure/db/search.repo.ts";

export function makeLookup(d: { readonly system: SystemDb }) {
  return {
    /** Фрагмент действующей версии (или любой версии по id — цитата в ответе ссылается на версию, CHAT-10). */
    fragment: async (versionId: string) => (await fragmentsByVersionIds(d.system, [versionId]))[0],
    actCard: (pravoId: string) => actCardRow(d.system, pravoId),
  };
}

export type Lookup = ReturnType<typeof makeLookup>;
