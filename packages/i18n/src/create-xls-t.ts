// t() файла Excel (XLS-02, XLS-04): словарь `xls` не входит в `resources` — сайт его не грузит (бюджет первой загрузки), а серверу нужен для
// названий листов и шапок книги. Свой экземпляр i18next на вызов, как `createLegalT`.
import { createInstance, type TFunction } from "i18next";
import { xls } from "./locales/ru/xls.ts";
import type { Language } from "./resources.ts";

/** Перевод по ключу словаря `xls` (без префикса пространства имён): `t("sheet.operations")`. */
export type XlsT = TFunction<"xls">;

export function createXlsT(language: Language = "ru"): XlsT {
  const instance = createInstance();
  void instance.init({
    lng: language,
    fallbackLng: false,
    resources: { ru: { xls } },
    ns: ["xls"],
    defaultNS: "xls",
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance.getFixedT(language, "xls");
}
