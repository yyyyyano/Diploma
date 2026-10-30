// Цели (BUD-04, BUD-06): копилка — человек сам вносит взносы (кнопкой или «отложи 200 на отпуск»), «по счёту» — прогресс
// равен остатку накопительного счёта или вклада. Создание, правка и взнос — сразу и с «Отменить» (P5, AGT-05), удаление —
// только ожидающее решение «Да/Нет» (AGT-07). Цель в BYN; счёт в другой валюте считается по курсу НБРБ через `accounts`.
import type {
  BudgetGoal,
  ContributeInput,
  CreateGoalInput,
  UpdateGoalInput,
} from "@kosht/contract";
import type { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import {
  deleteContribution,
  deleteGoal,
  insertContribution,
  insertGoal,
  lockGoal,
  updateGoal,
} from "../infrastructure/db/budgets.repo.ts";
import type { Channel, Deps } from "./deps.ts";
import { isSavingsKind, type Overview } from "./overview.ts";
import { goalSnapshot, UNCONTRIBUTE_HANDLER, type Revisions } from "./revisions.ts";
import type { Thresholds } from "./thresholds.ts";

/** Обработчик «Да» удаления цели. */
export const DELETE_GOAL_HANDLER = "budgets.delete-goal";

type Create = z.output<typeof CreateGoalInput>;
type Update = z.output<typeof UpdateGoalInput>;
type Contribute = z.output<typeof ContributeInput>;

export interface GoalChanged {
  readonly goal: BudgetGoal;
  readonly undoToken: string;
}

export function makeGoals(
  d: Deps,
  overview: Overview,
  revisions: Revisions,
  thresholds: Thresholds,
) {
  const { clock, realtime, log } = d.platform;

  const validMoney = (money: { minor: number; currency: string }) =>
    money.currency === "BYN" && money.minor > 0;

  /** Цель по `id` в виде для экрана — после записи, с теми же расчётами, что и в обзоре. */
  async function shown(s: ScopedDb, id: string): Promise<BudgetGoal> {
    const found = (await overview.view(s)).goals.find((goal) => goal.id === id);
    if (found === undefined) throw new Error("budgets: цель пропала после записи.");
    return found;
  }

  async function create(s: ScopedDb, input: Create, channel: Channel): Promise<GoalChanged> {
    if (!validMoney(input.target)) throw new AppError("VALIDATION", { reason: "target" });
    const today = clock.today();
    if (input.deadline <= today) throw new AppError("VALIDATION", { reason: "deadline-past" });
    if ((input.kind === "account") !== (input.accountId !== undefined)) {
      throw new AppError("VALIDATION", { reason: "account-kind" });
    }
    if (input.accountId !== undefined) {
      const balances = await d.accounts.balances(s);
      const account = balances.items.find((item) => item.id === input.accountId);
      // BUD-04: цель по счёту — только накопительный счёт или вклад; чужой и неизвестный счёт неотличимы.
      if (account === undefined) throw new AppError("NOT_FOUND");
      if (!isSavingsKind(account.kind))
        throw new AppError("VALIDATION", { reason: "account-kind" });
    }
    const { id, undoToken } = await s.transaction(async (tx) => {
      const id = await insertGoal(tx, {
        name: input.name,
        kind: input.kind,
        targetMinor: input.target.minor,
        deadline: input.deadline,
        accountId: input.accountId ?? null,
        createdOn: today,
      });
      const undoToken = await revisions.remember(
        tx,
        { kind: "goal", subjectId: id, before: null },
        channel,
      );
      await realtime.changed(tx, { entity: "goal", ids: [id] });
      return { id, undoToken };
    });
    // Цель по счёту могла уже стоять на 50 или 100 % по остатку.
    await thresholds.recheckGoals(s);
    log.info({ goalId: id }, "budgets.goal-created");
    return { goal: await shown(s, id), undoToken };
  }

  async function update(s: ScopedDb, input: Update, channel: Channel): Promise<GoalChanged> {
    if (input.target !== undefined && !validMoney(input.target)) {
      throw new AppError("VALIDATION", { reason: "target" });
    }
    if (input.deadline !== undefined && input.deadline <= clock.today()) {
      throw new AppError("VALIDATION", { reason: "deadline-past" });
    }
    const undoToken = await s.transaction(async (tx) => {
      const row = await lockGoal(tx, input.id);
      if (row === undefined) throw new AppError("NOT_FOUND");
      const undoToken = await revisions.remember(
        tx,
        { kind: "goal", subjectId: row.id, before: goalSnapshot(row) },
        channel,
      );
      await updateGoal(
        tx,
        row.id,
        {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.target === undefined ? {} : { targetMinor: input.target.minor }),
          ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
        },
        clock.now(),
      );
      await realtime.changed(tx, { entity: "goal", ids: [row.id] });
      return undoToken;
    });
    await thresholds.recheckGoals(s);
    return { goal: await shown(s, input.id), undoToken };
  }

  /** «Отложи 200 на отпуск»: взнос в копилку со днём «сегодня»; цель по счёту взносов не принимает. */
  async function contribute(
    s: ScopedDb,
    input: Contribute,
    channel: Channel,
  ): Promise<GoalChanged> {
    if (!validMoney(input.amount)) throw new AppError("VALIDATION", { reason: "amount" });
    const undoToken = await s.transaction(async (tx) => {
      const row = await lockGoal(tx, input.goalId);
      if (row === undefined) throw new AppError("NOT_FOUND");
      if (row.kind !== "piggy") throw new AppError("VALIDATION", { reason: "linked-goal" });
      const contributionId = await insertContribution(tx, {
        goalId: row.id,
        amountMinor: input.amount.minor,
        madeOn: clock.today(),
      });
      const undoToken = await d.actions.record(tx, {
        handler: UNCONTRIBUTE_HANDLER,
        payload: { contributionId, goalId: row.id },
        subject: `contribution:${contributionId}`,
        channel,
      });
      await realtime.changed(tx, { entity: "goal", ids: [row.id] });
      return undoToken;
    });
    await thresholds.recheckGoals(s);
    log.info({ goalId: input.goalId }, "budgets.contributed");
    return { goal: await shown(s, input.goalId), undoToken };
  }

  /** «Отменить» взнос (реестр undo): взноса больше нет; уже убран — ничего. */
  async function uncontribute(tx: ScopedDb, payload: unknown): Promise<void> {
    const body = payload as { contributionId?: unknown; goalId?: unknown } | null;
    if (typeof body?.contributionId !== "string" || typeof body.goalId !== "string") {
      throw new Error("budgets.uncontribute: нет contributionId и goalId в журнале.");
    }
    await deleteContribution(tx, body.contributionId);
    await realtime.changed(tx, { entity: "goal", ids: [body.goalId] });
  }

  /** AGT-07: удаление цели — только ожидающее решение; «Да» исполняет `confirmDelete`. */
  async function requestDelete(s: ScopedDb, id: string): Promise<string> {
    const row = await lockGoal(s, id);
    if (row === undefined) throw new AppError("NOT_FOUND");
    return d.actions.propose(s, {
      handler: DELETE_GOAL_HANDLER,
      payload: { goalId: row.id },
      summary: { key: "decisions.goalDelete", params: { name: row.name } },
    });
  }

  /** «Да» (реестр confirm): цель, её взносы и уведомления уходят; уже удалена — ничего. */
  async function confirmDelete(tx: ScopedDb, payload: unknown): Promise<void> {
    const goalId = (payload as { goalId?: unknown } | null)?.goalId;
    if (typeof goalId !== "string") throw new Error("budgets.delete-goal: нет goalId в решении.");
    const row = await lockGoal(tx, goalId);
    if (row === undefined) return;
    await deleteGoal(tx, goalId);
    await realtime.changed(tx, { entity: "goal", ids: [goalId] });
    log.info({ goalId }, "budgets.goal-deleted");
  }

  return { create, update, contribute, uncontribute, requestDelete, confirmDelete };
}

export type Goals = ReturnType<typeof makeGoals>;
