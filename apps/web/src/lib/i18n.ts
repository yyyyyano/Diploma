// Тексты сайта (NFR-19, ADR-0013): react-i18next на словарях @kosht/i18n — тех же, что у бота и писем. Свой
// экземпляр i18next, а не глобальный: словари уже в памяти, экземпляр готов сразу (initAsync: false).
import { NAMESPACES, resources, type Language } from "@kosht/i18n";
import { createInstance, type i18n } from "i18next";
import { initReactI18next } from "react-i18next";

export function createI18n(language: Language = "ru"): i18n {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: false,
    resources,
    ns: NAMESPACES,
    defaultNS: false,
    initAsync: false,
    // React экранирует вывод сам; иначе «1/2» стало бы «1&#x2F;2».
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return instance;
}
