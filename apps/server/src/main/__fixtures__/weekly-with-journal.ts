// Сценарии weekly на настоящих соседях: transactions (расходы по неделям), budgets (лимиты), calendar (события недели), categories
// (названия), explain (трассы), recurring и accounts — те же, что у стенда afford; уведомления — список в памяти (идемпотентный по
// виду и ключу, как настоящий notify). Модель — управляемая заглушка (`llm.extract`): тест решает, что она ответит или что её нет.
// Время — FakeClock из transactions-with-journal; пояс — умолчание настроек (Минск, UTC+3: 09:00 — это 06:00Z).
import { makeFacts } from "../../modules/weekly/application/facts.ts";
import { makeRead } from "../../modules/weekly/application/read.ts";
import { makeRun } from "../../modules/weekly/application/run.ts";
import { makeText } from "../../modules/weekly/application/text.ts";
import type { Deps } from "../../modules/weekly/application/deps.ts";
import type { TestDb } from "@kosht/testing/db";
import { affordWithJournal, clock } from "./afford-with-journal.ts";

export { clock };

export type ExtractCall = Parameters<Deps["llm"]["extract"]>;

export function weeklyWithJournal(db: TestDb) {
  const a = affordWithJournal(db);
  const r = a.r;
  /** Найденные вычеты tax — список, который тест заполняет сам. */
  const found: { kind: string; year: number }[] = [];
  const calls: ExtractCall[] = [];
  const state: { answer: (call: ExtractCall) => unknown } = {
    answer: () => {
      throw new Error("модели нет");
    },
  };
  const deps = {
    platform: r.deps.platform,
    transactions: { aggregate: r.t.ops.aggregate, firstOperationOn: r.t.ops.firstOperationOn },
    budgets: { overview: a.overview.view },
    calendar: { range: a.c.read.range },
    tax: { activeFound: async () => found },
    categories: r.t.categories,
    llm: {
      extract: async (...call: ExtractCall) => {
        calls.push(call);
        return state.answer(call);
      },
    },
    notifications: r.deps.notifications,
    explain: r.t.explain,
  } as unknown as Deps;
  const facts = makeFacts(deps);
  const text = makeText(deps);
  const run = makeRun(deps, facts, text);
  const read = makeRead(deps);
  return {
    a,
    r,
    s: r.s,
    found,
    calls,
    /** Что ответит модель; по умолчанию её нет (бросает). */
    answerWith: (answer: (call: ExtractCall) => unknown) => {
      state.answer = answer;
    },
    run,
    read,
    facts,
    notices: () => r.notices.filter((n) => n.kind === "weekly-summary"),
  };
}
