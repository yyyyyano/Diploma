// Источник облачного согласия для шлюза llm (PRIV-02, порт ConsentSource): последнее решение пользователя — без кэша,
// поэтому отзыв (T-016) действует на следующий же вызов модели. Решения нет — облако запрещено.
import type { ConsentSource } from "../../../platform/module/consent-source.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { latestConsent } from "../infrastructure/db/consents.repo.ts";

export function makeCloudConsentSource(d: Pick<Platform, "scoped">): ConsentSource {
  return async (scope) => (await latestConsent(d.scoped(scope), "cloud"))?.granted === true;
}
