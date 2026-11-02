// Канал `telegram` в реестре доставки уведомлений (TG-06, NOTIF-04, NOTIF-05, AUTH-11, PRIV-08): `notify` кладёт уведомление в
// каждый канал, где вид не отключён, — часто в транзакции источника (чек, импорт), а сеть в транзакции нельзя. Поэтому канал
// только ставит задачу `telegram.deliver-notification` (нагрузка — id уведомлений, OBS-04) в той же транзакции; шлёт воркер
// после коммита, от имени владельца (перепроверка владельца отбрасывает заблокированных). Сбой отправки уведомления не
// отменяет: оно уже в ленте сайта, а Telegram мог закрыть чат — пишем в лог и идём дальше.
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineJob } from "../../../platform/jobs/define-job.ts";
import type { DeliveryChannel } from "../../../platform/module/define-module.ts";
import { encodeCallback } from "../domain/callback-data.ts";
import { notificationView } from "../domain/notification-text.ts";
import { weekText } from "../domain/commands-text.ts";
import { objectPath } from "../domain/site-link.ts";
import { findLinkByUser } from "../infrastructure/db/telegram.repo.ts";
import { makeCategoryNames } from "./category-names.ts";
import type { TelegramDeps } from "./deps.ts";
import type { Keyboard } from "./ports.ts";
import { makeSiteLink } from "./site.ts";

export function makeNotificationDelivery(d: TelegramDeps) {
  const { t, nt, platform, neighbours, system } = d;
  const siteLink = makeSiteLink(d);
  const categoryNames = makeCategoryNames(d);

  /** Отправить уведомления пользователя scope в его чат: кому, что и с какими кнопками решает эта функция. */
  async function deliver(s: ScopedDb, ids: readonly string[]): Promise<void> {
    const link = await findLinkByUser(system, s.scope.userId);
    if (link === undefined) return;
    // AUTH-11: заблокированному не пишем; PRIV-08: согласие на Telegram отозвано — данные через Telegram не идут.
    if ((await neighbours.identity.memberState(s.scope)) !== "active") return;
    if (!(await neighbours.privacy.telegramConsentGiven(s))) return;
    const sender = await d.sender();
    if (sender === undefined) {
      platform.log.info({ reason: "no-token" }, "telegram.notification-skipped");
      return;
    }
    for (const notification of await neighbours.notifications.get(s, ids)) {
      try {
        const keyboard: Keyboard[number][] = [];
        let text: string;
        let suffix = "";
        if (notification.kind === "weekly-summary") {
          // WEEK-01: текст сводки пишет `weekly` и проверяет страж чисел; бот только доставляет его.
          const summary = await neighbours.weekly.latest(s);
          text = summary === null ? t("bot.notification.weeklyFallback") : weekText(t, summary);
          const site = await siteLink("/home");
          keyboard.push(...site.row);
          suffix = site.suffix;
        } else {
          const view = notificationView(
            nt,
            notification,
            notification.kind === "limit" ? await categoryNames(s) : (key) => key,
          );
          text = view.text;
          const different = notification.kind === "receipt-match";
          if (notification.decisionId !== null) {
            keyboard.push([
              {
                text: t("bot.buttons.yes"),
                data: encodeCallback({ action: "decision-yes", id: notification.decisionId }),
              },
              {
                text: t("bot.buttons.no"),
                data: encodeCallback({ action: "decision-no", id: notification.decisionId }),
              },
            ]);
          }
          if (notification.undoToken !== null) {
            keyboard.push([
              {
                text: t(different ? "bot.buttons.differentPurchases" : "bot.buttons.undo"),
                data: encodeCallback({ action: "undo", id: notification.undoToken }),
              },
            ]);
          }
          if (view.show !== undefined && "command" in view.show) {
            keyboard.push([
              {
                text: t("bot.buttons.showLimits"),
                data: encodeCallback({ action: "command", id: view.show.command }),
              },
            ]);
          } else if (view.show !== undefined) {
            const path = objectPath(view.show.objectRef);
            if (path !== undefined) {
              const site = await siteLink(path);
              keyboard.push(
                ...site.row.map((row) =>
                  row.map((button) => ({ ...button, text: t("bot.buttons.show") })),
                ),
              );
              suffix = site.suffix;
            }
          }
        }
        await sender.send(link.chatId, text + suffix, keyboard);
      } catch (error) {
        platform.log.warn(
          { err: error, reason: notification.kind },
          "telegram.notification-failed",
        );
      }
    }
  }

  const job = defineJob({
    name: "telegram.deliver-notification",
    payload: z.object({ ids: z.array(z.uuid()).min(1).max(100) }),
    options: { retryLimit: 2 },
    handle: async (ctx, payload) => {
      await deliver(ctx.s, payload.ids);
    },
  });

  /** Канал реестра доставки: ставит задачу в транзакции источника (откат — доставки нет). */
  const channel: DeliveryChannel = {
    name: "telegram",
    deliver: (s, ids) => platform.jobs.enqueue(s, job, { ids: [...ids] }),
  };

  return { channel, job, deliver };
}
