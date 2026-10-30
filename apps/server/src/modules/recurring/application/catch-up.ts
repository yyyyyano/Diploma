// Регулярные для истории, загруженной до появления модуля (T-030, T-031): подписка на transactions.changed ловит только
// новые операции, а старые лежали бы без поиска. Первое чтение платежей пустого домохозяйства в процессе запускает один
// пересчёт; нашёл ничего — больше в этом процессе не повторяется (ключ — домохозяйство, данных в памяти нет).
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { listItems } from "../infrastructure/db/recurring.repo.ts";

export function makeCatchUp(recompute: (s: ScopedDb) => Promise<string[]>) {
  const done = new Set<string>();
  return async function ensureComputed(s: ScopedDb): Promise<void> {
    const household = s.scope.householdId;
    if (done.has(household)) return;
    if ((await listItems(s)).length === 0) await recompute(s);
    done.add(household);
  };
}

export type CatchUp = ReturnType<typeof makeCatchUp>;
