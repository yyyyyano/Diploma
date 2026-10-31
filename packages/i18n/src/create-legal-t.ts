// t() правового консультанта (LEGAL-03…08): словарь `legal` не входит в `resources` — сайт его не грузит (бюджет первой загрузки),
// а серверу нужен для текстов под ответом. Свой экземпляр i18next на вызов, как `createT`.
import { createInstance, type TFunction } from "i18next";
import { legal } from "./locales/ru/legal.ts";
import type { Language } from "./resources.ts";

/** Перевод по ключу словаря `legal` (без префикса пространства имён): `t("quote.edition", { date })`. */
export type LegalT = TFunction<"legal">;

export function createLegalT(language: Language = "ru"): LegalT {
  const instance = createInstance();
  void instance.init({
    lng: language,
    fallbackLng: false,
    resources: { ru: { legal } },
    ns: ["legal"],
    defaultNS: "legal",
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance.getFixedT(language, "legal");
}
