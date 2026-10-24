// t() без React (NFR-19): бот, письма, уведомления и форматы этого пакета. Сайт подключает те же словари через
// react-i18next (T-008). Свой экземпляр i18next на вызов: глобальный i18next не трогается.
import { createInstance, type TFunction } from "i18next";
import { NAMESPACES, resources, type Language } from "./resources.ts";

/** Перевод по ключу `<ns>:<ключ>` с параметрами; ключи и параметры проверяет компилятор. */
export type T = TFunction<typeof NAMESPACES>;

export function createT(language: Language = "ru"): T {
  const instance = createInstance();
  // Словари уже в памяти, initAsync: false — экземпляр готов сразу после init, без ожидания промиса.
  void instance.init({
    lng: language,
    fallbackLng: false,
    resources,
    ns: NAMESPACES,
    defaultNS: false,
    initAsync: false,
    // Экранирует канал вывода (React, шаблон письма, бот), а не перевод: иначе «1/2» стало бы «1&#x2F;2».
    interpolation: { escapeValue: false },
  });
  return instance.getFixedT(language, NAMESPACES);
}
