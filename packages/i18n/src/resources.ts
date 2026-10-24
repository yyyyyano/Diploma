// Словари (NFR-19): ru — единственный язык MVP, be — задел. Типы ключей i18next берёт отсюда (ResourceNamespaceMap
// — способ i18next для пакета монорепозитория): несуществующий ключ не компилируется ни здесь, ни на сайте.
import { common } from "./locales/ru/common.ts";
import { errors } from "./locales/ru/errors.ts";
import { formulas } from "./locales/ru/formulas.ts";
import { tools } from "./locales/ru/tools.ts";

export const NAMESPACES = ["common", "errors", "formulas", "tools"] as const;

export type Namespace = (typeof NAMESPACES)[number];

export const LANGUAGES = ["ru"] as const;

export type Language = (typeof LANGUAGES)[number];

export const resources = {
  ru: { common, errors, formulas, tools },
} as const satisfies Record<Language, Record<Namespace, object>>;

declare module "i18next" {
  interface ResourceNamespaceMap {
    common: typeof common;
    errors: typeof errors;
    formulas: typeof formulas;
    tools: typeof tools;
  }
}
