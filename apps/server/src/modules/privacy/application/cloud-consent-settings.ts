// Облачное согласие в настройках (PRIV-02): дать и отозвать в любой момент. Решение — новая строка журнала с версией
// текста и моментом Clock, режим для админки (privacy_modes) и событие privacy.consent-changed — одной транзакцией.
// Источник согласия для шлюза llm кэша не держит, поэтому отзыв действует на следующий же вызов модели. Версия текста
// устарела (текст поменялся, пока вкладка была открыта) — CONFLICT: решение по другому тексту не информированное.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { consentChanged } from "../events.ts";
import {
  insertConsents,
  listConsents,
  type ConsentRecord,
} from "../infrastructure/db/consents.repo.ts";
import { saveMode } from "../infrastructure/db/modes.repo.ts";

/** Сколько решений показывает «История согласий». */
export const HISTORY_LIMIT = 200;

export interface PrivacyStateView {
  readonly cloud: { readonly granted: boolean; readonly since: Date | undefined };
  readonly history: readonly ConsentRecord[];
}

export function makeCloudConsentSettings(d: Pick<Platform, "clock" | "events" | "log">) {
  /** Облако разрешено ли (последнее облачное решение) и с какого момента; история решений, новые сверху. */
  async function state(s: ScopedDb): Promise<PrivacyStateView> {
    const history = await listConsents(s, HISTORY_LIMIT);
    const cloud = history.find((record) => record.kind === "cloud");
    const granted = cloud?.granted === true;
    return { cloud: { granted, since: granted ? cloud?.at : undefined }, history };
  }

  /** Дать (granted) или отозвать облачное согласие. */
  async function setCloudConsent(
    s: ScopedDb,
    decision: { readonly granted: boolean; readonly version: string },
  ): Promise<PrivacyStateView> {
    if (decision.version !== CONSENT_VERSIONS.cloud) {
      throw new AppError("CONFLICT", { reason: "consent-version" });
    }
    const at = d.clock.now();
    await s.transaction(async (tx) => {
      const ids = await insertConsents(
        tx,
        [{ kind: "cloud", granted: decision.granted, textVersion: decision.version }],
        at,
      );
      await saveMode(tx.db, tx.scope.userId, decision.granted, at);
      await d.events.publish(tx, consentChanged, { ids });
    });
    d.log.info(
      { userId: s.scope.userId, status: decision.granted ? "granted" : "revoked" },
      "privacy.cloud-consent-changed",
    );
    return state(s);
  }

  return { state, setCloudConsent };
}

export type CloudConsentSettings = ReturnType<typeof makeCloudConsentSettings>;
