// Сценарии операций одним набором для роутера, инструментов и корня модуля (сценарий = файл — см. соседей: read, write,
// remove, restore, background); здесь они только собираются из общих частей.
import { makeBackground } from "./background.ts";
import { makeAggregate } from "./aggregate.ts";
import { makeBulk } from "./bulk.ts";
import type { Deps, JobRefs } from "./deps.ts";
import { makeLedger } from "./ledger.ts";
import { makeMatch } from "./match.ts";
import { makeReceiptOps } from "./receipt-ops.ts";
import { makePrepare } from "./prepare.ts";
import { makeRead } from "./read.ts";
import { makeRemove } from "./remove.ts";
import { makeRestore } from "./restore.ts";
import { makeRule } from "./rule.ts";
import { makeWrite } from "./write.ts";

/** Общие части без задач (задачам нужны обработчики фона — их собирает фабрика ниже). */
export function makeBase(d: Deps) {
  const prepare = makePrepare(d);
  const ledger = makeLedger(d);
  return { prepare, ledger, background: makeBackground(d, { prepare, ledger }) };
}

export function makeOperations(d: Deps, base: ReturnType<typeof makeBase>, jobs: JobRefs) {
  const parts = { prepare: base.prepare, ledger: base.ledger, jobs };
  const bulk = makeBulk(d, parts);
  const rule = makeRule(d, bulk);
  return {
    ...makeAggregate(d),
    ...makeRead(d, parts),
    ...makeWrite(d, parts, rule),
    ...makeRemove(d, parts),
    ...makeReceiptOps(d, parts),
    ...makeMatch(d, parts),
    ...makeRestore(d, parts, rule),
    requestChangeCategory: bulk.requestChangeCategory,
    requestMarkTransfer: bulk.requestMarkTransfer,
    confirmChangeCategory: bulk.confirmChangeCategory,
    confirmMarkTransfer: bulk.confirmMarkTransfer,
    confirmApplyRule: bulk.confirmApplyRule,
  };
}

export type Operations = ReturnType<typeof makeOperations>;
