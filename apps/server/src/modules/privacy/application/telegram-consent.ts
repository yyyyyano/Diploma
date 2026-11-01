// Согласие на Telegram (PRIV-08): отдельный вид журнала. Дают на сайте перед подключением бота («Подключить Telegram»),
// отзывают отключением (кнопка на сайте, /unlink, удаление аккаунта). Решение — новая строка журнала с версией текста и
// моментом Clock и событие privacy.consent-changed одной транзакцией. Режим `privacy_modes` не трогаем: он про облако.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { consentChanged } from "../events.ts";
import { insertConsents, latestConsent } from "../infrastructure/db/consents.repo.ts";

export function makeTelegramConsent(d: Pick<Platform, "clock" | "events" | "log">) {
  /** Записать решение; версия не по действующему тексту — CONFLICT (человек видел другой текст). */
  async function set(
    s: ScopedDb,
    decision: { readonly granted: boolean; readonly version: string },
  ): Promise<void> {
    if (decision.granted && decision.version !== CONSENT_VERSIONS.telegram) {
      throw new AppError("CONFLICT", { reason: "consent-version" });
    }
    const at = d.clock.now();
    await s.transaction(async (tx) => {
      const ids = await insertConsents(
        tx,
        [{ kind: "telegram", granted: decision.granted, textVersion: decision.version }],
        at,
      );
      await d.events.publish(tx, consentChanged, { ids });
    });
    d.log.info(
      { userId: s.scope.userId, status: decision.granted ? "granted" : "revoked" },
      "privacy.telegram-consent-changed",
    );
  }

  /** Действует ли согласие на Telegram сейчас: последнее решение — «дано» по действующему тексту. */
  async function given(s: ScopedDb): Promise<boolean> {
    const last = await latestConsent(s, "telegram");
    return last?.granted === true && last.textVersion === CONSENT_VERSIONS.telegram;
  }

  return { set, given };
}
