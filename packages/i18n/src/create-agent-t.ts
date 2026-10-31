// t() агента (AGT-04, AGT-07, AGT-12, P6): словарь `agent` не входит в `resources` — его пишет программа в ответ, сайт
// словарь не грузит. Свой экземпляр i18next на вызов, как `createLegalT`.
import { createInstance, type TFunction } from "i18next";
import { agent } from "./locales/ru/agent.ts";
import type { Language } from "./resources.ts";

/** Перевод по ключу словаря `agent` (без префикса пространства имён): `t("offTopic")`. */
export type AgentT = TFunction<"agent">;

export function createAgentT(language: Language = "ru"): AgentT {
  const instance = createInstance();
  void instance.init({
    lng: language,
    fallbackLng: false,
    resources: { ru: { agent } },
    ns: ["agent"],
    defaultNS: "agent",
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance.getFixedT(language, "agent");
}
