// Агрегаты операций пачками (FIN-01, RCPT-09, EXPL-01): итоги периода по категориям, месяцам или контрагентам для fin,
// budgets, dashboard, weekly и агента. Число запросов не растёт с числом групп (два на период); числа — `@kosht/calc`.
// Переводы не входят, возврат уменьшает расходы своей категории, операции без курса не входят в сумму (их число —
// `missingRates`), операция с разбивкой чека идёт по частям (RCPT-09).
import { categoryTotal, groupSum, node, totalOf, type Calc, type GroupSum } from "@kosht/calc";
import type { AggregateInput, TransactionAggregate } from "@kosht/contract";
import { Money, TraceId } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { MAX_REFS } from "../../explain/index.ts";
import {
  countWithoutRate,
  firstOperationOn,
  groupSums,
  type GroupRow,
  type Kind,
} from "../infrastructure/db/aggregate.repo.ts";
import type { Deps } from "./deps.ts";
import type { z } from "zod";

type Input = z.output<typeof AggregateInput>;

/** Группа с числами `Calc` — для соседей (`fin`, `budgets`, `dashboard`): трасса с основаниями-операциями. */
export interface AggregateGroupCalc {
  readonly key: string;
  readonly expense: Calc<Money>;
  readonly income: Calc<Money>;
}

export interface AggregateCalc {
  readonly groups: readonly AggregateGroupCalc[];
  readonly income: Calc<Money>;
  readonly expense: Calc<Money>;
  readonly missingRates: number;
}

/** В ответ агенту — не больше стольких групп (остальное — `truncated`): компактный выход (ARCHITECTURE §8.2). */
const MAX_GROUPS = 50;

const zero = (key: string) => node(key, Money.of(0, "BYN"));

export function makeAggregate(d: Pick<Deps, "settings" | "explain">) {
  async function aggregate(s: ScopedDb, input: Input): Promise<AggregateCalc> {
    const maxRefs = await d.settings.get(MAX_REFS);
    const period = { from: input.from, to: input.to };
    const rows = await groupSums(s, { ...period, groupBy: input.groupBy, maxRefs });
    const byKey = new Map<string, Map<Kind, GroupRow>>();
    for (const row of rows) {
      const kinds = byKey.get(row.key) ?? new Map<Kind, GroupRow>();
      kinds.set(row.kind, row);
      byKey.set(row.key, kinds);
    }
    const leaf = (kinds: Map<Kind, GroupRow>, kind: Kind, key: string): Calc<Money> | undefined => {
      const row = kinds.get(kind);
      return row === undefined ? undefined : groupSum(key, row satisfies GroupSum, maxRefs);
    };
    const groups: AggregateGroupCalc[] = [...byKey.entries()].map(([key, kinds]) => ({
      key,
      expense: categoryTotal(
        leaf(kinds, "expense", "transactions.expense") ?? zero("transactions.expense"),
        leaf(kinds, "refund", "transactions.refund"),
      ),
      income: leaf(kinds, "income", "transactions.income") ?? zero("transactions.income"),
    }));
    return {
      groups,
      income: totalOf(
        "transactions.income",
        [...byKey.entries()].flatMap(([key, kinds]) =>
          kinds.has("income")
            ? [groups.find((g) => g.key === key)?.income ?? zero("transactions.income")]
            : [],
        ),
      ),
      expense: totalOf(
        "transactions.expense",
        groups.map((g) => g.expense),
      ),
      missingRates: await countWithoutRate(s, period),
    };
  }

  /** Для инструмента агента: те же числа с traceId — расчёты сохраняются пачкой, повтор не плодит строки. */
  async function aggregateWithTraces(s: ScopedDb, input: Input): Promise<TransactionAggregate> {
    const result = await aggregate(s, input);
    const shown = result.groups.slice(0, MAX_GROUPS);
    const period = { from: input.from, to: input.to };
    const ids = await d.explain.saveMany(
      s,
      [result.income, result.expense, ...shown.map((g) => g.expense)],
      { period },
    );
    const [incomeTrace, expenseTrace, ...groupTraces] = ids;
    if (incomeTrace === undefined || expenseTrace === undefined) {
      throw new Error("explain.saveMany не вернул id итогов.");
    }
    return {
      ...input,
      income: result.income.value,
      incomeTraceId: TraceId.parse(incomeTrace),
      expense: result.expense.value,
      expenseTraceId: TraceId.parse(expenseTrace),
      missingRates: result.missingRates,
      groups: shown.map((group, index) => ({
        key: group.key,
        expense: group.expense.value,
        income: group.income.value,
        traceId: TraceId.parse(groupTraces[index]),
      })),
      truncated: result.groups.length > MAX_GROUPS,
    };
  }

  /** День первой операции — для «по данным за N мес.» (FIN-20). */
  async function firstOn(s: ScopedDb): Promise<string | undefined> {
    return firstOperationOn(s);
  }

  return { aggregate, aggregateWithTraces, firstOperationOn: firstOn };
}
