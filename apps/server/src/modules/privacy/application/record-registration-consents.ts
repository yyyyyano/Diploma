// Согласия при регистрации (AUTH-02, PRIV-01, PRIV-02): пишутся в транзакции нового пользователя (identity,
// new-user-scope.ts) — нет пользователя, нет и согласий, и наоборот. Версии — те, что видел человек; устарели (текст
// поменялся, пока форма была открыта) — CONFLICT: согласие на другой текст не считается информированным.
import type { RegistrationConsents } from "@kosht/contract";
import { CONSENT_VERSIONS } from "@kosht/i18n";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { consentChanged } from "../events.ts";
import { insertConsents } from "../infrastructure/db/consents.repo.ts";
import { saveMode } from "../infrastructure/db/modes.repo.ts";

export function makeRecordRegistrationConsents(d: Pick<Platform, "clock" | "events">) {
  return async function recordRegistrationConsents(
    tx: ScopedDb,
    consents: RegistrationConsents,
  ): Promise<void> {
    if (
      consents.personalData.version !== CONSENT_VERSIONS.personalData ||
      consents.cloud.version !== CONSENT_VERSIONS.cloud
    ) {
      throw new AppError("CONFLICT", { reason: "consent-version" });
    }
    const at = d.clock.now();
    const ids = await insertConsents(
      tx,
      [
        { kind: "personal-data", granted: true, textVersion: consents.personalData.version },
        { kind: "cloud", granted: consents.cloud.accepted, textVersion: consents.cloud.version },
      ],
      at,
    );
    // Режим для админки (PRIV-07, T-017) — в той же транзакции, что и журнал.
    await saveMode(tx.db, tx.scope.userId, consents.cloud.accepted, at);
    await d.events.publish(tx, consentChanged, { ids });
  };
}
