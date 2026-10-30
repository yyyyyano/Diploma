// Сценарии recurring на настоящих соседях: операции — transactions (с accounts, merchants, categories, журналом actions),
// факты профиля — настоящий profile, «Откуда эта цифра?» — explain. Уведомления и события — списки в памяти: тест
// проверяет, что ушло. Время — FakeClock из transactions-with-journal (по умолчанию 28.10.2026).
import { SystemCategoryCode } from "@kosht/contract";
import { LocalDate, Money } from "@kosht/kernel";
import type { TestDb } from "@kosht/testing/db";
import type { ScopedDb } from "../../platform/db/scoped-db.ts";
import {
  clock,
  entry,
  newScope,
  transactionsWithJournal,
  WEB,
} from "./transactions-with-journal.ts";
import { makeFacts } from "../../modules/profile/application/facts.ts";
import { generateHistory } from "../../../../../tooling/synth/history/history.ts";
import { makeCatchUp } from "../../modules/recurring/application/catch-up.ts";
import { makeDecisions, RESTORE_HANDLER } from "../../modules/recurring/application/decisions.ts";
import { makeSyncFacts } from "../../modules/recurring/application/facts.ts";
import { makeMissed } from "../../modules/recurring/application/missed.ts";
import { makeRead } from "../../modules/recurring/application/read.ts";
import { makeRecompute } from "../../modules/recurring/application/recompute.ts";
import type { Deps } from "../../modules/recurring/application/deps.ts";
import { makeForecast } from "../../modules/fin/application/forecast.ts";
import { makeFreeBalance } from "../../modules/fin/application/free-balance.ts";
import type { Deps as FinDeps } from "../../modules/fin/application/deps.ts";

export { clock, newScope };

export interface Notice {
  readonly kind: string;
  readonly key: string;
  readonly objectRef?: { entity: string; id: string } | undefined;
  readonly params?: unknown;
}

export function recurringWithJournal(db: TestDb) {
  const t = transactionsWithJournal(db);
  const notices: Notice[] = [];
  const facts = makeFacts({ platform: t.platform, actions: t.actions });
  const platform = {
    ...t.platform,
    settings: { get: async (def: { default: unknown }) => def.default as never },
  };
  const deps = {
    platform,
    transactions: t.transactionsFacade,
    profile: { getFacts: facts.getFacts, upsertDerivedFact: facts.upsertDerivedFact },
    notifications: {
      notify: async (_tx: ScopedDb, input: Notice) => {
        // Идемпотентно по виду и ключу — как настоящий notify.
        if (notices.some((n) => n.kind === input.kind && n.key === input.key)) return undefined;
        notices.push(input);
        return `notice-${notices.length}`;
      },
    },
    actions: t.actions,
    explain: t.explain,
  } as unknown as Deps;
  const syncFacts = makeSyncFacts(deps);
  const recompute = makeRecompute(deps, syncFacts);
  const read = makeRead(deps, makeCatchUp(recompute));
  const decisions = makeDecisions(deps, syncFacts);
  const checkMissed = makeMissed(deps, syncFacts);
  t.registerUndo(RESTORE_HANDLER, decisions.restore);
  t.registerUndo("profile.restore", facts.restore);

  /** Операции истории в базу: каждая — настоящая запись с контрагентом и категорией. */
  async function seed(
    s: ScopedDb,
    operations: readonly {
      date: string;
      merchant: string;
      type: "income" | "expense";
      amountMinor: number;
      category: string;
    }[],
  ): Promise<void> {
    for (const op of operations) {
      await t.ops.create(
        s,
        entry({
          type: op.type,
          occurredOn: LocalDate.parse(op.date),
          amount: Money.of(op.amountMinor, "BYN"),
          merchant: op.merchant,
          category: { type: "system", code: SystemCategoryCode.parse(op.category) },
        }),
        WEB,
      );
    }
  }

  const recurringEvents = () => t.published.filter((e) => e.name === "recurring.changed");

  // fin (T-031): свободный остаток и прогноз на тех же настоящих соседях, recurring — настоящие сценарии выше.
  const finDeps = {
    platform,
    accounts: t.accounts,
    transactions: t.transactionsFacade,
    recurring: { list: read.list, upcoming: read.upcoming },
    profile: { getFacts: facts.getFacts, upsertDerivedFact: facts.upsertDerivedFact },
    explain: t.explain,
  } as unknown as FinDeps;
  const fin = { ...makeFreeBalance(finDeps), ...makeForecast(finDeps) };

  return {
    fin,
    t,
    s: (): ScopedDb => newScope(db),
    seed,
    read,
    decisions,
    recompute,
    checkMissed,
    notices,
    recurringEvents,
    facts,
    generateHistory,
    deps,
  };
}
