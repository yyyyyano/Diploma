// Лимиты месяца и цели с прогрессом (BUD-02, BUD-04, BUD-05, BUD-07): сборка пачками — расходы категорий одним
// агрегатом, остатки счетов и свободный остаток фасадами, взносы копилок двумя запросами; числа — `@kosht/calc`, каждое
// показываемое число сохраняется для «Откуда эта цифра?» (`explain.saveMany`: повтор — те же traceId). Для главной
// (`dashboard`) и экрана «Лимиты и цели» — один и тот же ответ; пороги уведомлений берут отсюда же расчёты без сохранения.
import {
  goalBehind,
  goalPercent,
  goalPlanned,
  limitPercent,
  monthsLeft,
  node,
  recommendedContribution,
  sub,
  type Calc,
} from "@kosht/calc";
import type {
  BudgetGoal,
  BudgetLimit,
  BudgetsOverview,
  GoalPreview,
  PreviewGoalInput,
} from "@kosht/contract";
import { BudgetMonth, GoalId, LimitId } from "@kosht/contract";
import { LocalDate, Money, TraceId, type TraceValue } from "@kosht/kernel";
import type { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { FreeBalanceCalc } from "../../fin/index.ts";
import { daysLeft, monthBounds, monthOf } from "../domain/month.ts";
import {
  contributionSums,
  listGoals,
  listLimits,
  recentContributions,
  type GoalRow,
  type LimitRow,
} from "../infrastructure/db/budgets.repo.ts";
import { GOAL_BEHIND_TOLERANCE_PCT } from "../settings.ts";
import type { Deps } from "./deps.ts";

const BYN = "BYN";
const RECENT_CONTRIBUTIONS = 20;
/** Накопительные счета и вклады — единственное, к чему привязывается цель (BUD-04). */
const SAVINGS_KINDS = new Set(["savings", "deposit"]);

export interface LimitCalc {
  readonly row: LimitRow;
  readonly spent: Calc<Money>;
  readonly remaining: Calc<Money>;
  readonly percent: Calc<number>;
}

export interface GoalCalc {
  readonly row: GoalRow;
  /** Счёт цели «по счёту» удалён или не накопительный — прогресс неизвестен. */
  readonly accountMissing: boolean;
  readonly saved: Calc<Money> | null;
  readonly percent: Calc<number> | null;
  readonly monthsLeft: number;
  readonly contribution: Calc<Money> | null;
  readonly planned: Calc<Money>;
  readonly behind: boolean;
}

export const isSavingsKind = (kind: string): boolean => SAVINGS_KINDS.has(kind);

export function makeOverview(d: Deps) {
  const { clock, settings } = d.platform;

  /** Расходы категорий месяца одним агрегатом → лимиты с процентом и остатком. */
  async function limitCalcs(
    s: ScopedDb,
    month: string,
    rows: readonly LimitRow[],
  ): Promise<{ limits: LimitCalc[]; missingRates: number }> {
    if (rows.length === 0) return { limits: [], missingRates: 0 };
    const { from, to } = monthBounds(month);
    const aggregate = await d.transactions.aggregate(s, { from, to, groupBy: "category" });
    const byKey = new Map(aggregate.groups.map((group) => [group.key, group.expense]));
    const limits = rows.map((row): LimitCalc => {
      const limit = Money.of(row.limitMinor, BYN);
      const spent =
        byKey.get(row.categoryKey) ?? node("transactions.categoryTotal", Money.of(0, BYN));
      return {
        row,
        spent,
        remaining: sub("budgets.limitRemaining", node("budgets.limit", limit), [spent]),
        percent: limitPercent(spent, limit),
      };
    });
    return { limits, missingRates: aggregate.missingRates };
  }

  /** Накоплено, процент, взнос, плановая сумма и «отстаёт» целей; остатки счетов — один вызов на все цели по счёту. */
  async function goalCalcs(s: ScopedDb, rows: readonly GoalRow[]): Promise<GoalCalc[]> {
    if (rows.length === 0) return [];
    const today = clock.today();
    const tolerance = await settings.get(GOAL_BEHIND_TOLERANCE_PCT);
    const [sums, balances] = await Promise.all([
      contributionSums(s),
      rows.some((row) => row.kind === "account") ? d.accounts.balances(s) : undefined,
    ]);
    return rows.map((row): GoalCalc => {
      const target = Money.of(row.targetMinor, BYN);
      let saved: Calc<Money> | null;
      let accountMissing = false;
      if (row.kind === "piggy") {
        saved = node("budgets.goalSaved", Money.of(sums.get(row.id) ?? 0, BYN));
      } else {
        const account = balances?.items.find((item) => item.id === row.accountId);
        accountMissing = account === undefined || !isSavingsKind(account.kind);
        // Нет курса счёта в другой валюте — «нет курса», а не 0 (BUD-04): накопленного нет.
        saved = accountMissing ? null : (account?.inByn ?? null);
      }
      const months = monthsLeft(today, LocalDate.parse(row.deadline));
      const planned = goalPlanned({
        target,
        createdOn: LocalDate.parse(row.createdOn),
        deadline: LocalDate.parse(row.deadline),
        today,
      });
      return {
        row,
        accountMissing,
        saved,
        percent: saved === null ? null : goalPercent(saved, target),
        monthsLeft: months,
        contribution: saved === null ? null : recommendedContribution({ target, saved, months }),
        planned,
        behind: saved !== null && goalBehind(saved.value, planned.value, tolerance),
      };
    });
  }

  /** Расчёты для порогов уведомлений: без свободного остатка и без записи трасс. */
  async function limitsOfMonth(s: ScopedDb, month: string): Promise<LimitCalc[]> {
    return (await limitCalcs(s, month, await listLimits(s))).limits;
  }

  async function view(s: ScopedDb, month?: string): Promise<BudgetsOverview> {
    const today = clock.today();
    const shown = BudgetMonth.parse(month ?? monthOf(today));
    const [limitRows, goalRows, free] = await Promise.all([
      listLimits(s),
      listGoals(s),
      d.fin.freeBalance(s),
    ]);
    const [{ limits, missingRates }, goals, recent] = await Promise.all([
      limitCalcs(s, shown, limitRows),
      goalCalcs(s, goalRows),
      recentContributions(
        s,
        goalRows.filter((row) => row.kind === "piggy").map((row) => row.id),
        RECENT_CONTRIBUTIONS,
      ),
    ]);
    const traces = await saveTraces(s, shown, limits, goals, free);
    return {
      month: shown,
      daysLeft: daysLeft(today, shown),
      limits: limits.map((calc, index) => limitView(calc, traces.limits[index], missingRates)),
      goals: goals.map((calc, index) =>
        goalView(
          calc,
          traces.goals[index],
          free,
          recent.filter((c) => c.goalId === calc.row.id),
        ),
      ),
      freeBalance: free.balance?.value ?? null,
      freeBalanceTraceId: traces.freeBalance,
    };
  }

  /** Все показываемые числа — двумя пачками: процент лимитов (период — месяц) и числа целей со свободным остатком. */
  async function saveTraces(
    s: ScopedDb,
    month: string,
    limits: readonly LimitCalc[],
    goals: readonly GoalCalc[],
    free: FreeBalanceCalc,
  ) {
    const limitIds = await d.explain.saveMany(
      s,
      limits.map((calc) => calc.percent),
      { period: monthBounds(month) },
    );
    const calcs: Calc<TraceValue>[] = [];
    const slots = goals.map((calc) => {
      const slot = { percent: -1, contribution: -1 };
      if (calc.percent !== null) slot.percent = calcs.push(calc.percent) - 1;
      if (calc.contribution !== null) slot.contribution = calcs.push(calc.contribution) - 1;
      return slot;
    });
    const freeSlot = free.balance === null ? -1 : calcs.push(free.balance) - 1;
    const ids = await d.explain.saveMany(s, calcs);
    const at = (slot: number) => (slot < 0 ? null : TraceId.parse(ids[slot]));
    return {
      limits: limitIds.map((id) => TraceId.parse(id)),
      goals: slots.map((slot) => ({
        percent: at(slot.percent),
        contribution: at(slot.contribution),
      })),
      // Свободный остаток fin сохраняет вместе с окном месяцев; здесь тот же расчёт — тот же traceId, если окно то же.
      freeBalance: at(freeSlot),
    };
  }

  function limitView(
    calc: LimitCalc,
    traceId: TraceId | undefined,
    missingRates: number,
  ): BudgetLimit {
    if (traceId === undefined) throw new Error("explain.saveMany не вернул id лимита.");
    return {
      id: LimitId.parse(calc.row.id),
      categoryKey: calc.row.categoryKey,
      limit: Money.of(calc.row.limitMinor, BYN),
      spent: calc.spent.value,
      remaining: calc.remaining.value,
      percent: calc.percent.value,
      traceId,
      notify80: calc.row.notifyAt80,
      notify100: calc.row.notifyAt100,
      missingRates,
    };
  }

  function goalView(
    calc: GoalCalc,
    traces: { percent: TraceId | null; contribution: TraceId | null } | undefined,
    free: FreeBalanceCalc,
    recent: readonly { id: string; amountMinor: number; madeOn: string }[],
  ): BudgetGoal {
    const { row } = calc;
    return {
      id: GoalId.parse(row.id),
      name: row.name,
      kind: row.kind === "account" ? "account" : "piggy",
      target: Money.of(row.targetMinor, BYN),
      deadline: LocalDate.parse(row.deadline),
      createdOn: LocalDate.parse(row.createdOn),
      accountId: row.accountId === null ? null : (row.accountId as BudgetGoal["accountId"]),
      accountMissing: calc.accountMissing,
      saved: calc.saved?.value ?? null,
      percent: calc.percent?.value ?? null,
      traceId: traces?.percent ?? null,
      monthsLeft: calc.monthsLeft,
      contribution: calc.contribution?.value ?? null,
      contributionTraceId: traces?.contribution ?? null,
      fitsFreeBalance: fits(calc.contribution, free),
      planned: calc.planned.value,
      behind: calc.behind,
      contributions: recent.map((c) => ({
        id: c.id,
        amount: Money.of(c.amountMinor, BYN),
        madeOn: LocalDate.parse(c.madeOn),
      })),
    };
  }

  /** BUD-05: укладывается ли взнос в свободный остаток; остатка нет («недостаточно данных») — `null`, а не «нет». */
  function fits(contribution: Calc<Money> | null, free: FreeBalanceCalc): boolean | null {
    if (contribution === null || free.balance === null) return null;
    return contribution.value.minor <= free.balance.value.minor;
  }

  /** Окно «Новая цель»: взнос и «укладывается» до записи цели (BUD-05); цель по счёту берёт остаток счёта. */
  async function preview(
    s: ScopedDb,
    input: z.output<typeof PreviewGoalInput>,
  ): Promise<GoalPreview> {
    const today = clock.today();
    if (input.target.currency !== BYN || input.target.minor <= 0) throw new AppError("VALIDATION");
    if (input.deadline <= today) throw new AppError("VALIDATION", { reason: "deadline-past" });
    const [free, balances] = await Promise.all([
      d.fin.freeBalance(s),
      input.accountId === undefined ? undefined : d.accounts.balances(s),
    ]);
    let saved: Calc<Money> = node("budgets.goalSaved", Money.of(0, BYN));
    if (balances !== undefined) {
      const account = balances.items.find((item) => item.id === input.accountId);
      if (account === undefined || !isSavingsKind(account.kind)) {
        throw new AppError("VALIDATION", { reason: "account-kind" });
      }
      if (account.inByn === null) throw new AppError("VALIDATION", { reason: "no-rate" });
      saved = account.inByn;
    }
    const months = monthsLeft(today, input.deadline);
    const contribution = recommendedContribution({ target: input.target, saved, months });
    return {
      monthsLeft: months,
      contribution: contribution.value,
      fitsFreeBalance: fits(contribution, free),
      freeBalance: free.balance?.value ?? null,
    };
  }

  return { view, preview, limitsOfMonth, goalCalcs };
}

export type Overview = ReturnType<typeof makeOverview>;
