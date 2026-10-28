// События privacy (ADR-0004): нагрузка — пачка id строк журнала согласий, без самих решений (OBS-04); подписчик
// перечитывает актуальное согласие через ctx.s.
import { z } from "zod";
import { defineEvent } from "../../platform/events/define-event.ts";

/** Согласия изменились (PRIV-01, PRIV-02): ids — новые строки privacy_consents. */
export const consentChanged = defineEvent({
  name: "privacy.consent-changed",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});

/** Архив «Мои данные» собран (PRIV-05): ids — готовые заявки privacy_exports; уведомление о готовности шлёт подписчик. */
export const exportReady = defineEvent({
  name: "privacy.export-ready",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});
