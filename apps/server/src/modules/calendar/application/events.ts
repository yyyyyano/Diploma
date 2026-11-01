// Свои события и правка (CAL-06, CAL-07, P5): создать и изменить — сразу, с «Отменить»; удалить — только ожидающее решение
// «Да/Нет» (AGT-07), «Да» исполняет `confirmDelete` и тоже оставляет «Отменить». Автоматические события (гарантии, сроки налогов)
// удалить нельзя — человек может сдвинуть день и убрать напоминания.
import type { CalendarEntry, CreateEventInput, UpdateEventInput } from "@kosht/contract";
import type { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import {
  findEvent,
  insertEvent,
  patchEvent,
  removeEvent,
  type EventRow,
} from "../infrastructure/db/calendar.repo.ts";
import { finalize, storedItem } from "./entries.ts";
import type { Channel, Deps, Via } from "./deps.ts";
import type { Reminders } from "./reminders.ts";

export const UNDO_CREATE_HANDLER = "calendar.undo-create";
export const RESTORE_HANDLER = "calendar.restore";
export const DELETE_HANDLER = "calendar.delete-event";
export const UNDELETE_HANDLER = "calendar.undelete";

type CreateInput = z.output<typeof CreateEventInput>;
type UpdateInput = z.output<typeof UpdateEventInput>;

export interface EventChanged {
  readonly event: CalendarEntry;
  readonly undoToken: string;
}

export function makeEvents(d: Deps, reminders: Reminders) {
  const { clock, realtime, log } = d.platform;

  async function present(s: ScopedDb, row: EventRow): Promise<CalendarEntry> {
    const today = clock.today();
    const { entries } = await finalize(s, d.explain, [storedItem(row)], today, today);
    return entries[0] as CalendarEntry;
  }

  function needFuture(day: string): void {
    if (day < clock.today()) throw new AppError("VALIDATION", { field: "on", reason: "past" });
  }

  /** CAL-06: своё событие; день не в прошлом, сумма — только положительные BYN. */
  async function create(
    s: ScopedDb,
    input: CreateInput,
    channel: Channel,
    via: Via = "site",
  ): Promise<EventChanged> {
    needFuture(input.on);
    const amount = input.amount;
    if (amount !== undefined && (amount.currency !== "BYN" || amount.minor <= 0)) {
      throw new AppError("VALIDATION", { field: "amount" });
    }
    const remindDays = input.remindDays ?? (await reminders.defaults(input.type));
    const row = await s.transaction(async (tx) => {
      const id = await insertEvent(tx, {
        type: input.type,
        title: input.title,
        day: input.on,
        amountMinor: amount === undefined ? null : amount.minor,
        origin: via === "chat" ? "chat" : "user",
        remindDays,
      });
      if (id === undefined) throw new AppError("INTERNAL");
      await reminders.replan(tx, id, { day: input.on, remindDays, dayChanged: true });
      const undoToken = await d.actions.record(tx, {
        handler: UNDO_CREATE_HANDLER,
        payload: { eventId: id },
        subject: `calendar-event:${id}`,
        channel,
      });
      await realtime.changed(tx, { entity: "calendar-event", ids: [id] });
      const stored = await findEvent(tx, id);
      return { stored: stored as EventRow, undoToken };
    });
    log.info({ eventId: row.stored.id, status: via }, "calendar.event-created");
    return { event: await present(s, row.stored), undoToken: row.undoToken };
  }

  /** Новый день и (или) напоминания хранимого события; вычисляемые события (платежи) править нельзя — их нет в таблице. */
  async function update(s: ScopedDb, input: UpdateInput, channel: Channel): Promise<EventChanged> {
    if (input.on !== undefined) needFuture(input.on);
    const result = await s.transaction(async (tx) => {
      const row = await findEvent(tx, input.id);
      if (row === undefined) throw new AppError("NOT_FOUND");
      const day = input.on ?? row.day;
      const remindDays = input.remindDays ?? row.remindDays;
      const dayChanged = input.on !== undefined && input.on !== row.day;
      await patchEvent(tx, row.id, {
        day,
        remindDays: [...remindDays],
        onEdited: row.onEdited || dayChanged,
      });
      await reminders.replan(tx, row.id, { day, remindDays, dayChanged });
      const undoToken = await d.actions.record(tx, {
        handler: RESTORE_HANDLER,
        payload: {
          eventId: row.id,
          before: { day: row.day, remindDays: row.remindDays, onEdited: row.onEdited },
        },
        subject: `calendar-event:${row.id}`,
        channel,
      });
      await realtime.changed(tx, { entity: "calendar-event", ids: [row.id] });
      return { row: (await findEvent(tx, row.id)) as EventRow, undoToken };
    });
    return { event: await present(s, result.row), undoToken: result.undoToken };
  }

  /** AGT-07: удаление — только ожидающее решение; удалить можно добавленное человеком. */
  async function requestDelete(s: ScopedDb, id: string): Promise<string> {
    const row = await findEvent(s, id);
    if (row === undefined) throw new AppError("NOT_FOUND");
    if (row.origin !== "user" && row.origin !== "chat") {
      throw new AppError("VALIDATION", { field: "id", reason: "not-deletable" });
    }
    return d.actions.propose(s, {
      handler: DELETE_HANDLER,
      payload: { eventId: row.id },
      summary: { key: "decisions.calendarDelete", params: { title: row.title ?? "" } },
    });
  }

  /** «Да» (реестр confirm): событие и его напоминания уходят; «Отменить» возвращает с тем же id. Уже удалено — ничего. */
  async function confirmDelete(tx: ScopedDb, payload: unknown): Promise<string | undefined> {
    const eventId = (payload as { eventId?: unknown } | null)?.eventId;
    if (typeof eventId !== "string")
      throw new Error("calendar.delete-event: нет eventId в решении.");
    const row = await findEvent(tx, eventId);
    if (row === undefined) return undefined;
    await removeEvent(tx, eventId);
    const undoToken = await d.actions.record(tx, {
      handler: UNDELETE_HANDLER,
      payload: { snapshot: snapshotOf(row) },
      subject: `calendar-event:${eventId}`,
      channel: "web",
    });
    await realtime.changed(tx, { entity: "calendar-event", ids: [eventId] });
    return undoToken;
  }

  /** «Отменить» создание: событие уходит (прошло или уже удалено — ничего). */
  async function undoCreate(tx: ScopedDb, payload: unknown): Promise<void> {
    const eventId = (payload as { eventId?: unknown } | null)?.eventId;
    if (typeof eventId !== "string") return;
    if ((await findEvent(tx, eventId)) === undefined) return;
    await removeEvent(tx, eventId);
    await realtime.changed(tx, { entity: "calendar-event", ids: [eventId] });
  }

  /** «Отменить» правку: день и напоминания такие, какими были до действия. */
  async function restore(tx: ScopedDb, payload: unknown): Promise<void> {
    const body = payload as {
      eventId?: unknown;
      before?: { day?: unknown; remindDays?: unknown; onEdited?: unknown };
    } | null;
    const eventId = body?.eventId;
    const before = body?.before;
    if (typeof eventId !== "string" || before === undefined) return;
    const row = await findEvent(tx, eventId);
    if (row === undefined) return;
    const day = typeof before.day === "string" ? before.day : null;
    const remindDays = Array.isArray(before.remindDays)
      ? before.remindDays.filter((n): n is number => typeof n === "number")
      : [...row.remindDays];
    await patchEvent(tx, eventId, { day, remindDays, onEdited: before.onEdited === true });
    await reminders.replan(tx, eventId, { day, remindDays, dayChanged: day !== row.day });
    await realtime.changed(tx, { entity: "calendar-event", ids: [eventId] });
  }

  /** «Отменить» удаление: событие снова в календаре с тем же id и напоминаниями. */
  async function undelete(tx: ScopedDb, payload: unknown): Promise<void> {
    const snapshot = (payload as { snapshot?: Snapshot } | null)?.snapshot;
    if (snapshot === undefined || typeof snapshot.id !== "string") return;
    if ((await findEvent(tx, snapshot.id)) !== undefined) return;
    await insertEvent(tx, {
      id: snapshot.id,
      type: snapshot.type,
      title: snapshot.title,
      rule: snapshot.rule,
      day: snapshot.day,
      amountMinor: snapshot.amountMinor,
      currency: snapshot.currency,
      origin: snapshot.origin,
      params: snapshot.params,
      refEntity: snapshot.refEntity,
      refId: snapshot.refId,
      key: snapshot.key,
      remindDays: snapshot.remindDays,
      onEdited: snapshot.onEdited,
    });
    await reminders.replan(tx, snapshot.id, {
      day: snapshot.day,
      remindDays: snapshot.remindDays,
      dayChanged: true,
    });
    await realtime.changed(tx, { entity: "calendar-event", ids: [snapshot.id] });
  }

  return { create, update, requestDelete, confirmDelete, undoCreate, restore, undelete };
}

type Snapshot = Omit<EventRow, "householdId" | "userId" | "createdAt" | "updatedAt">;

/** Строка события без владельца и служебных меток — для «Отменить» удаление. */
function snapshotOf(row: EventRow): Snapshot {
  const { householdId: _h, userId: _u, createdAt: _c, updatedAt: _p, ...rest } = row;
  return rest;
}

export type Events = ReturnType<typeof makeEvents>;
