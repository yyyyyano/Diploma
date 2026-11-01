// t() Telegram-бота (TG-01…05): тексты ответов бота пишет сервер, а подписи вкладки «Telegram» и поля токена — сайт (словарь
// подгружается вместе со вкладкой, в `resources` его нет). Свой экземпляр i18next на вызов, как `createWeeklyT`.
import { createInstance, type TFunction } from "i18next";
import { telegram } from "./locales/ru/telegram.ts";
import type { Language } from "./resources.ts";

/** Перевод по ключу словаря `telegram` (без префикса пространства имён): `t("bot.start.linked")`. */
export type TelegramT = TFunction<"telegram">;

export function createTelegramT(language: Language = "ru"): TelegramT {
  const instance = createInstance();
  void instance.init({
    lng: language,
    fallbackLng: false,
    resources: { ru: { telegram } },
    ns: ["telegram"],
    defaultNS: "telegram",
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance.getFixedT(language, "telegram");
}
