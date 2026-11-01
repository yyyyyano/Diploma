// Автоматические события (CAL-02, CAL-04): гарантии по чекам и (T-048) сроки налогов и страховки по фактам профиля. `run` — пересчёт
// по событию (чек, факт профиля, подтверждённое значение таблицы), `ensure` — то же при открытии календаря и главной, не чаще раза
// в минуту на пользователя: событие могло прийти, когда значение таблицы ещё не было подтверждено, или другому пользователю.
import { createScopedCache } from "../../../platform/cache/scoped-cache.ts";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Deps } from "./deps.ts";

/** Не чаще: пересчёт читает таблицу ставок, профиль и чеки. */
const FRESH_MS = 60_000;

export function makeSync(d: Deps, parts: readonly ((s: ScopedDb) => Promise<number>)[]) {
  const cache = createScopedCache<true>({ max: 1000, ttlMs: FRESH_MS, clock: d.platform.clock });

  async function run(s: ScopedDb): Promise<number> {
    let created = 0;
    for (const part of parts) created += await part(s);
    cache(s).set(`sync:${s.scope.userId}`, true);
    return created;
  }

  async function ensure(s: ScopedDb): Promise<void> {
    if (cache(s).get(`sync:${s.scope.userId}`) === true) return;
    await run(s);
  }

  return { run, ensure };
}

export type Sync = ReturnType<typeof makeSync>;
