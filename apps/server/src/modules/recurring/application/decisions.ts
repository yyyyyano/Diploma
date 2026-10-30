// Решения человека о регулярных платежах (REC-02, P5): «Да, регулярный», «Это не регулярный», «Да, прекращён», «Вернуть в
// регулярные», «Ещё придёт», «Исправить сумму и дату», «Добавить вручную». Каждое — одна транзакция: ревизия «до»,
// сам платёж, запись в журнал отмены (actions), событие recurring.changed и сигнал сайту. «Отменить» возвращает
// человеческие поля из ревизии. Исключённый платёж остаётся строкой — по ней поиск знает, что «это не регулярный».
import type { RecurringCreateInput, RecurringEditInput } from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { dayOfMonth, firstOccurrence } from "../domain/dates.ts";
import { nextExpected } from "../domain/detect.ts";
import type { Section, State } from "../domain/rules.ts";
import { recurringChanged } from "../events.ts";
import {
  deleteItem,
  findRevision,
  insertItem,
  insertRevision,
  lockItem,
  updateItem,
  type ItemRow,
} from "../infrastructure/db/recurring.repo.ts";
import type { Channel, Deps } from "./deps.ts";
import type { makeSyncFacts } from "./facts.ts";
import { toEntry, type RecurringEntry } from "./view.ts";

/** Обработчик «Отменить» модуля: вернуть платёж таким, каким он был до действия человека. */
export const RESTORE_HANDLER = "recurring.restore";

export interface Changed {
  readonly item: RecurringEntry;
  readonly undoToken: string;
}

type Edit = z.output<typeof RecurringEditInput>;
type Create = z.output<typeof RecurringCreateInput>;

export function makeDecisions(d: Deps, syncFacts: ReturnType<typeof makeSyncFacts>) {
  const { clock, events, realtime, log } = d.platform;

  async function changed(tx: ScopedDb, id: string): Promise<void> {
    await events.publish(tx, recurringChanged, { ids: [id] });
    await realtime.changed(tx, { entity: "recurring", ids: [id] });
  }

  /** Платёж под блокировкой; чужой и неизвестный — `NOT_FOUND` (неотличимы). */
  async function liveItem(tx: ScopedDb, id: string): Promise<ItemRow> {
    const row = await lockItem(tx, id);
    if (row === undefined) throw new AppError("NOT_FOUND");
    return row;
  }

  /** Ревизия «до» и запись «Отменить»; возвращает undoToken. */
  async function remember(tx: ScopedDb, row: ItemRow, channel: Channel): Promise<string> {
    const revisionId = await insertRevision(tx, {
      itemId: row.id,
      existed: true,
      section: row.section,
      period: row.period,
      state: row.state,
      anchorDay: row.anchorDay,
      manualAmountMinor: row.manualAmountMinor,
      nextExpectedOn: row.nextExpectedOn,
      ackExpectedOn: row.ackExpectedOn,
      userFixed: row.userFixed,
    });
    return d.actions.record(tx, {
      handler: RESTORE_HANDLER,
      payload: { revisionId },
      subject: `recurring:${row.id}`,
      channel,
    });
  }

  async function finish(tx: ScopedDb, id: string, undoToken: string): Promise<Changed> {
    await changed(tx, id);
    const row = await lockItem(tx, id);
    if (row === undefined) throw new Error("recurring_items: платёж пропал после записи.");
    return { item: toEntry(row, clock.today()), undoToken };
  }

  /** Перевод в состояние: `from` — откуда можно, иначе `CONFLICT` (кто-то успел раньше). */
  async function moveTo(
    s: ScopedDb,
    id: string,
    from: readonly State[],
    patch: (row: ItemRow) => Partial<ItemRow>,
    channel: Channel,
  ): Promise<Changed> {
    const result = await s.transaction(async (tx) => {
      const row = await liveItem(tx, id);
      if (!from.includes(row.state as State)) throw new AppError("CONFLICT");
      const undoToken = await remember(tx, row, channel);
      await updateItem(tx, id, patch(row), clock.now());
      return finish(tx, id, undoToken);
    });
    await syncFacts(s);
    log.info({ recurringId: id }, "recurring.decided");
    return result;
  }

  const confirm = (s: ScopedDb, id: string, channel: Channel) =>
    moveTo(s, id, ["suggested"], () => ({ state: "active" }), channel);

  const exclude = (s: ScopedDb, id: string, channel: Channel) =>
    moveTo(
      s,
      id,
      ["active", "suggested", "maybe-ended", "ended"],
      () => ({ state: "excluded" }),
      channel,
    );

  const end = (s: ScopedDb, id: string, channel: Channel) =>
    moveTo(s, id, ["active", "suggested", "maybe-ended"], () => ({ state: "ended" }), channel);

  const resume = (s: ScopedDb, id: string, channel: Channel) =>
    moveTo(s, id, ["ended", "excluded"], () => ({ state: "active" }), channel);

  /** REC-05 «Ещё придёт»: на эту ожидаемую дату «возможно прекращён» больше не ставится. */
  const stillComing = (s: ScopedDb, id: string, channel: Channel) =>
    moveTo(
      s,
      id,
      ["maybe-ended"],
      (row) => ({ state: "active", ackExpectedOn: row.nextExpectedOn }),
      channel,
    );

  /** «Исправить сумму и дату»: меняется присланное, и поиск эти поля больше не перетирает. */
  async function edit(s: ScopedDb, input: Edit, channel: Channel): Promise<Changed> {
    const result = await s.transaction(async (tx) => {
      const row = await liveItem(tx, input.id);
      if (row.state === "excluded") throw new AppError("CONFLICT");
      const fixed = new Set(row.userFixed);
      const patch: Partial<ItemRow> = {};
      if (input.amount !== undefined) {
        if (input.amount.currency !== "BYN" || input.amount.minor <= 0) {
          throw new AppError("VALIDATION");
        }
        patch.manualAmountMinor = input.amount.minor;
        fixed.add("amount");
      }
      const period = input.period ?? (row.period as "week" | "month" | "quarter" | "year");
      if (input.period !== undefined) {
        patch.period = input.period;
        fixed.add("period");
      }
      let anchorDay = row.anchorDay;
      if (input.anchorDay !== undefined) {
        anchorDay = input.anchorDay;
        fixed.add("day");
      }
      if (period !== "week" && anchorDay === null) {
        anchorDay =
          row.lastOccurredOn === null ? null : dayOfMonth(LocalDate.parse(row.lastOccurredOn));
      }
      patch.anchorDay = period === "week" ? null : anchorDay;
      if (input.section !== undefined) {
        if ((input.section === "income") !== (row.flow === "income"))
          throw new AppError("VALIDATION");
        patch.section = input.section;
        fixed.add("section");
      }
      patch.userFixed = [...fixed];
      patch.nextExpectedOn =
        row.lastOccurredOn === null
          ? firstOccurrence(period, patch.anchorDay, clock.today())
          : nextExpected(period, LocalDate.parse(row.lastOccurredOn), patch.anchorDay);
      const undoToken = await remember(tx, row, channel);
      await updateItem(tx, input.id, patch, clock.now());
      return finish(tx, input.id, undoToken);
    });
    await syncFacts(s);
    return result;
  }

  /** «Добавить вручную»: платёж без повторов — сумма, период и день от человека; действует сразу. */
  async function create(s: ScopedDb, input: Create, channel: Channel): Promise<Changed> {
    if (input.amount.currency !== "BYN" || input.amount.minor <= 0)
      throw new AppError("VALIDATION");
    const today = clock.today();
    const section: Section = input.section;
    const anchorDay = input.period === "week" ? null : (input.anchorDay ?? dayOfMonth(today));
    const result = await s.transaction(async (tx) => {
      const id = await insertItem(tx, {
        seriesKey: `manual|${randomUUID()}`,
        name: input.name,
        flow: section === "income" ? "income" : "expense",
        section,
        period: input.period,
        state: "active",
        source: "manual",
        anchorDay,
        manualAmountMinor: input.amount.minor,
        nextExpectedOn: firstOccurrence(input.period, anchorDay, today),
        userFixed: ["amount", "period", "day", "section"],
      });
      if (id === undefined) throw new Error("recurring_items: серия добавленного вручную занята.");
      const revisionId = await insertRevision(tx, {
        itemId: id,
        existed: false,
        section,
        period: input.period,
        state: "active",
        anchorDay,
        manualAmountMinor: input.amount.minor,
        nextExpectedOn: firstOccurrence(input.period, anchorDay, today),
        ackExpectedOn: null,
        userFixed: [],
      });
      const undoToken = await d.actions.record(tx, {
        handler: RESTORE_HANDLER,
        payload: { revisionId },
        subject: `recurring:${id}`,
        channel,
      });
      return finish(tx, id, undoToken);
    });
    await syncFacts(s);
    return result;
  }

  /** «Отменить» (реестр undo): платёж снова такой, каким был до действия; добавленного вручную — не было. */
  async function restore(tx: ScopedDb, payload: unknown): Promise<void> {
    const revisionId = (payload as { revisionId?: unknown } | null)?.revisionId;
    const revision =
      typeof revisionId === "string" ? await findRevision(tx, revisionId) : undefined;
    if (revision === undefined) throw new Error("recurring.restore: нет ревизии из журнала.");
    await lockItem(tx, revision.itemId);
    if (!revision.existed) {
      await deleteItem(tx, revision.itemId);
    } else {
      await updateItem(
        tx,
        revision.itemId,
        {
          section: revision.section,
          period: revision.period,
          state: revision.state,
          anchorDay: revision.anchorDay,
          manualAmountMinor: revision.manualAmountMinor,
          nextExpectedOn: revision.nextExpectedOn,
          ackExpectedOn: revision.ackExpectedOn,
          userFixed: revision.userFixed,
        },
        clock.now(),
      );
    }
    await changed(tx, revision.itemId);
    await syncFacts(tx);
  }

  return { confirm, exclude, end, resume, stillComing, edit, create, restore };
}

export type Decisions = ReturnType<typeof makeDecisions>;
