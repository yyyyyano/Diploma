// Лимиты по категориям (BUD-01, BUD-06): новый или правка — одним вызовом (у категории один лимит), с «Отменить»;
// удаление — только ожидающее решение «Да/Нет» (AGT-07). После записи пороги проверяются сразу: лимит, заведённый или
// сниженный поверх уже сделанных трат, уведомляет, не дожидаясь следующей операции (КП BUD).
import { SYSTEM_CATEGORIES, type BudgetLimit, type SetLimitInput } from "@kosht/contract";
import type { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { monthOf } from "../domain/month.ts";
import {
  deleteLimit,
  insertLimit,
  listLimits,
  lockLimit,
  lockLimitByCategory,
  updateLimit,
} from "../infrastructure/db/budgets.repo.ts";
import type { Channel, Deps } from "./deps.ts";
import type { Overview } from "./overview.ts";
import { limitSnapshot, type Revisions } from "./revisions.ts";
import type { Thresholds } from "./thresholds.ts";

/** Обработчик «Да» удаления лимита. */
export const DELETE_LIMIT_HANDLER = "budgets.delete-limit";

type Input = z.output<typeof SetLimitInput>;

export interface LimitChanged {
  readonly limit: BudgetLimit;
  readonly undoToken: string;
}

export function makeLimits(
  d: Deps,
  overview: Overview,
  revisions: Revisions,
  thresholds: Thresholds,
) {
  const { clock, realtime, log } = d.platform;

  /** Лимит ставится на расходную категорию: встроенную из каталога или свою пользователя. */
  async function assertExpenseCategory(s: ScopedDb, key: string): Promise<void> {
    const [kind, id] = key.split(":");
    if (kind === "system") {
      const known = SYSTEM_CATEGORIES.find((category) => category.code === id);
      if (known?.kind !== "expense") throw new AppError("VALIDATION", { reason: "category" });
      return;
    }
    const { items } = await d.categories.list(s);
    const own = items.find((item) => item.ref.type === "custom" && item.ref.id === id);
    if (own?.kind !== "expense") throw new AppError("VALIDATION", { reason: "category" });
  }

  async function set(s: ScopedDb, input: Input, channel: Channel): Promise<LimitChanged> {
    if (input.limit.currency !== "BYN" || input.limit.minor <= 0) {
      throw new AppError("VALIDATION", { reason: "limit" });
    }
    await assertExpenseCategory(s, input.categoryKey);
    const { id, undoToken } = await s.transaction(async (tx) => {
      const existing = await lockLimitByCategory(tx, input.categoryKey);
      const flags = {
        notifyAt80: input.notify80 ?? existing?.notifyAt80 ?? true,
        notifyAt100: input.notify100 ?? existing?.notifyAt100 ?? true,
      };
      let id: string;
      if (existing !== undefined) {
        const before = limitSnapshot(existing);
        await updateLimit(
          tx,
          existing.id,
          { limitMinor: input.limit.minor, ...flags },
          clock.now(),
        );
        id = existing.id;
        const undoToken = await revisions.remember(
          tx,
          { kind: "limit", subjectId: id, before },
          channel,
        );
        await realtime.changed(tx, { entity: "budget", ids: [id] });
        return { id, undoToken };
      }
      const created = await insertLimit(tx, {
        categoryKey: input.categoryKey,
        limitMinor: input.limit.minor,
        ...flags,
      });
      // Параллельный запрос успел завести лимит этой категории: пусть человек повторит и получит правку.
      if (created === undefined) throw new AppError("CONFLICT");
      id = created;
      const undoToken = await revisions.remember(
        tx,
        { kind: "limit", subjectId: id, before: null },
        channel,
      );
      await realtime.changed(tx, { entity: "budget", ids: [id] });
      return { id, undoToken };
    });
    // Новый или сниженный лимит мог оказаться ниже уже сделанных трат: пороги — сразу (BUD-03).
    await thresholds.recheckLimits(s);
    log.info({ limitId: id }, "budgets.limit-set");
    const shown = (await overview.view(s, monthOf(clock.today()))).limits.find((l) => l.id === id);
    if (shown === undefined) throw new Error("budgets: лимит пропал после записи.");
    return { limit: shown, undoToken };
  }

  /** AGT-07: удаление лимита — только ожидающее решение; «Да» исполняет `confirmDelete`. */
  async function requestDelete(s: ScopedDb, id: string): Promise<string> {
    const row = await lockLimit(s, id);
    if (row === undefined) throw new AppError("NOT_FOUND");
    return d.actions.propose(s, {
      handler: DELETE_LIMIT_HANDLER,
      payload: { limitId: row.id },
      summary: { key: "decisions.limitDelete", params: { category: row.categoryKey } },
    });
  }

  /** «Да» (реестр confirm): лимит и его уведомления уходят; уже удалён — ничего. */
  async function confirmDelete(tx: ScopedDb, payload: unknown): Promise<void> {
    const limitId = (payload as { limitId?: unknown } | null)?.limitId;
    if (typeof limitId !== "string")
      throw new Error("budgets.delete-limit: нет limitId в решении.");
    const row = await lockLimit(tx, limitId);
    if (row === undefined) return;
    await deleteLimit(tx, limitId);
    await realtime.changed(tx, { entity: "budget", ids: [limitId] });
    log.info({ limitId }, "budgets.limit-deleted");
  }

  return { set, requestDelete, confirmDelete, list: listLimits };
}

export type Limits = ReturnType<typeof makeLimits>;
