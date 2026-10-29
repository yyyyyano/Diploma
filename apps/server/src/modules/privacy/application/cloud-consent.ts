// Источник облачного согласия для шлюза llm (PRIV-02, порт ConsentSource): последнее решение пользователя — без кэша,
// поэтому отзыв (T-016) действует на следующий же вызов модели. Решения нет — облако запрещено. Согласие по прежнему
// тексту (версия не совпала с действующей, T-023) не действует до повторного: человек не читал нового текста — про
// сканы выписок и условия бесплатных тарифов провайдеров, — значит, и не соглашался на него.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import type { ConsentSource } from "../../../platform/module/consent-source.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { latestConsent } from "../infrastructure/db/consents.repo.ts";

export function makeCloudConsentSource(d: Pick<Platform, "scoped">): ConsentSource {
  return async (scope) => {
    const last = await latestConsent(d.scoped(scope), "cloud");
    return last?.granted === true && last.textVersion === CONSENT_VERSIONS.cloud;
  };
}
