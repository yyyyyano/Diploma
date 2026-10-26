// Уведомить пользователя (NOTIF-01…05, BUD-03): фасад для модулей-источников. Идемпотентно по ключу (вид + ключ):
// повторная доставка события «хотя бы раз» не плодит уведомления. Новое уведомление уходит в каждый канал реестра
// (web — эта же лента, telegram — T-053), где вид не отключён пользователем (NOTIF-04). Уведомление с действием
// ссылается на ожидающее решение actions (decisionId) или токен отмены, а не хранит свой вопрос.
import type { UserNotificationKind } from "@kosht/contract";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { disabledPairs, insertNotification } from "../infrastructure/db/notifications.repo.ts";

export interface NotifyInput {
  readonly kind: UserNotificationKind;
  /** Ключ идемпотентности: «лимит + месяц + порог» (BUD-03), id импорта и т. п. */
  readonly key: string;
  readonly objectRef?: { readonly entity: string; readonly id: string };
  readonly decisionId?: string;
  readonly undoToken?: string;
  /** Параметры текста из словаря по виду: числа и id, без ПД в логах (параметры в лог не пишутся). */
  readonly params?: Record<string, string | number>;
}

export function makeNotify(d: Pick<Platform, "clock" | "log" | "deliveryChannels">) {
  return async function notify(s: ScopedDb, input: NotifyInput): Promise<string | undefined> {
    const id = await insertNotification(
      s,
      {
        kind: input.kind,
        key: input.key,
        params: input.params ?? {},
        objectRef: input.objectRef,
        decisionId: input.decisionId,
        undoToken: input.undoToken,
      },
      d.clock.now(),
    );
    if (id === undefined) return undefined;
    const disabled = new Set(
      (await disabledPairs(s)).filter((p) => p.kind === input.kind).map((p) => p.channel),
    );
    for (const channel of d.deliveryChannels().values()) {
      if (!disabled.has(channel.name)) await channel.deliver(s, [id]);
    }
    d.log.info({ notificationId: id, reason: input.kind }, "notifications.created");
    return id;
  };
}
