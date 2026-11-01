// t() итогов недели (WEEK-02): шаблон текста без модели пишет сервер, а подписи карточки и настроек — сайт (словарь `weekly` подгружается
// с карточкой и настройками, в `resources` его нет). Свой экземпляр i18next на вызов, как `createAgentT`.
import { createInstance, type TFunction } from "i18next";
import { weekly } from "./locales/ru/weekly.ts";
import type { Language } from "./resources.ts";

/** Перевод по ключу словаря `weekly` (без префикса пространства имён): `t("template.spent", { amount })`. */
export type WeeklyT = TFunction<"weekly">;

export function createWeeklyT(language: Language = "ru"): WeeklyT {
  const instance = createInstance();
  void instance.init({
    lng: language,
    fallbackLng: false,
    resources: { ru: { weekly } },
    ns: ["weekly"],
    defaultNS: "weekly",
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance.getFixedT(language, "weekly");
}
