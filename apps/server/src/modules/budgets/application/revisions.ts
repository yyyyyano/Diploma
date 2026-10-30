// Ревизии лимитов и целей: поля «до» действия человека и «Отменить» по ним (P5). Создание — «до» нет, отмена убирает
// строку; правка — возвращает прежние значения. Цель, в которую уже внесли взносы, созданием не отменяется — `CONFLICT`:
// иначе отмена тихо унесла бы взносы.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import {
  countContributions,
  deleteGoal,
  deleteLimit,
  findRevision,
  insertRevision,
  lockGoal,
  lockLimit,
  updateGoal,
  updateLimit,
  type GoalRow,
  type LimitRow,
  type RevisionSnapshot,
} from "../infrastructure/db/budgets.repo.ts";
import type { Channel, Deps } from "./deps.ts";

/** Обработчик «Отменить» лимитов и целей: вернуть поля из ревизии или убрать созданное. */
export const RESTORE_HANDLER = "budgets.restore";
/** Обработчик «Отменить» взноса в копилку: убрать взнос. */
export const UNCONTRIBUTE_HANDLER = "budgets.uncontribute";

export const limitSnapshot = (row: LimitRow): RevisionSnapshot => ({
  limitMinor: row.limitMinor,
  notifyAt80: row.notifyAt80,
  notifyAt100: row.notifyAt100,
});

export const goalSnapshot = (row: GoalRow): RevisionSnapshot => ({
  name: row.name,
  targetMinor: row.targetMinor,
  deadline: row.deadline,
});

export function makeRevisions(d: Pick<Deps, "platform" | "actions">) {
  const { clock, realtime } = d.platform;

  /** Ревизия и запись «Отменить» в транзакции действия; возвращает undoToken. */
  async function remember(
    tx: ScopedDb,
    input: { kind: "limit" | "goal"; subjectId: string; before: RevisionSnapshot | null },
    channel: Channel,
  ): Promise<string> {
    const revisionId = await insertRevision(tx, {
      kind: input.kind,
      subjectId: input.subjectId,
      existed: input.before !== null,
      before: input.before ?? {},
    });
    return d.actions.record(tx, {
      handler: RESTORE_HANDLER,
      payload: { revisionId },
      subject: `${input.kind}:${input.subjectId}`,
      channel,
    });
  }

  /** «Отменить» (реестр undo): лимит или цель снова такие, какими были; созданные — убираются. */
  async function restore(tx: ScopedDb, payload: unknown): Promise<void> {
    const revisionId = (payload as { revisionId?: unknown } | null)?.revisionId;
    const revision =
      typeof revisionId === "string" ? await findRevision(tx, revisionId) : undefined;
    if (revision === undefined) throw new Error("budgets.restore: нет ревизии из журнала.");
    const before = revision.before;
    if (revision.kind === "limit") {
      const row = await lockLimit(tx, revision.subjectId);
      if (row !== undefined) {
        if (!revision.existed) await deleteLimit(tx, row.id);
        else {
          await updateLimit(
            tx,
            row.id,
            {
              limitMinor: Number(before["limitMinor"]),
              notifyAt80: before["notifyAt80"] === true,
              notifyAt100: before["notifyAt100"] === true,
            },
            clock.now(),
          );
        }
      }
      await realtime.changed(tx, { entity: "budget", ids: [revision.subjectId] });
      return;
    }
    const row = await lockGoal(tx, revision.subjectId);
    if (row !== undefined) {
      if (!revision.existed) {
        if ((await countContributions(tx, row.id)) > 0) throw new AppError("CONFLICT");
        await deleteGoal(tx, row.id);
      } else {
        await updateGoal(
          tx,
          row.id,
          {
            name: String(before["name"]),
            targetMinor: Number(before["targetMinor"]),
            deadline: String(before["deadline"]),
          },
          clock.now(),
        );
      }
    }
    await realtime.changed(tx, { entity: "goal", ids: [revision.subjectId] });
  }

  return { remember, restore };
}

export type Revisions = ReturnType<typeof makeRevisions>;
