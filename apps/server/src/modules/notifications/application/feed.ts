// Лента колокольчика и настройки по видам и каналам (NOTIF-01, NOTIF-04): курсор — id последнего показанного, счётчик
// непрочитанных, «прочитано» — только свои; настройки — вид × канал, по умолчанию включено.
import { USER_NOTIFICATION_KINDS, type UserNotification } from "@kosht/contract";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import {
  countUnread,
  byIds,
  disabledPairs,
  feedPage,
  markRead,
  savePreference,
  type FeedRow,
} from "../infrastructure/db/notifications.repo.ts";

function toDto(row: FeedRow): UserNotification {
  return {
    id: row.id,
    kind: row.kind as UserNotification["kind"],
    params: row.params,
    objectRef: row.objectRef,
    decisionId: row.decisionId,
    undoToken: row.undoToken,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function makeFeed(d: Pick<Platform, "clock" | "realtime">) {
  async function list(s: ScopedDb, input: { cursor?: string | undefined; limit: number }) {
    const rows = await feedPage(s, input.cursor, input.limit);
    const page = rows.slice(0, input.limit);
    return {
      items: page.map(toDto),
      nextCursor: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
      unread: await countUnread(s),
    };
  }

  /** Уведомления по id для канала доставки Telegram (T-053): тот же вид, что в ленте. */
  async function get(s: ScopedDb, ids: readonly string[]): Promise<UserNotification[]> {
    return (await byIds(s, ids)).map(toDto);
  }

  async function read(s: ScopedDb, ids: readonly string[] | "all"): Promise<void> {
    await markRead(s, ids, d.clock.now());
    // Счётчик в других вкладках того же пользователя обновится сам.
    if (ids !== "all") await d.realtime.changed(s, { entity: "notification", ids });
  }

  async function preferences(s: ScopedDb) {
    const disabled = await disabledPairs(s);
    const off = (kind: string, channel: string) =>
      disabled.some((p) => p.kind === kind && p.channel === channel);
    return {
      items: USER_NOTIFICATION_KINDS.map((kind) => ({
        kind,
        web: !off(kind, "web"),
        telegram: !off(kind, "telegram"),
      })),
    };
  }

  async function setPreference(
    s: ScopedDb,
    pref: { kind: string; channel: string; enabled: boolean },
  ): Promise<void> {
    await savePreference(s, pref, d.clock.now());
  }

  return { list, get, read, preferences, setPreference };
}
