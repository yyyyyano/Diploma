// Словари (NFR-19): ru — единственный язык MVP, be — задел. Типы ключей i18next берёт отсюда (ResourceNamespaceMap
// — способ i18next для пакета монорепозитория): несуществующий ключ не компилируется ни здесь, ни на сайте.
import { accounts } from "./locales/ru/accounts.ts";
import { assistant } from "./locales/ru/assistant.ts";
import { auth } from "./locales/ru/auth.ts";
import { common } from "./locales/ru/common.ts";
import { errors } from "./locales/ru/errors.ts";
import { formulas } from "./locales/ru/formulas.ts";
import { mail } from "./locales/ru/mail.ts";
import { setup } from "./locales/ru/setup.ts";
import { shell } from "./locales/ru/shell.ts";
import { tools } from "./locales/ru/tools.ts";
import { ui } from "./locales/ru/ui.ts";

export const NAMESPACES = [
  "common",
  "errors",
  "formulas",
  "tools",
  "mail",
  "shell",
  "ui",
  "auth",
  "setup",
  "accounts",
  "assistant",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export const LANGUAGES = ["ru"] as const;

export type Language = (typeof LANGUAGES)[number];

export const resources = {
  ru: { common, errors, formulas, tools, mail, shell, ui, auth, setup, accounts, assistant },
} as const satisfies Record<Language, Record<Namespace, object>>;

declare module "i18next" {
  interface ResourceNamespaceMap {
    common: typeof common;
    errors: typeof errors;
    formulas: typeof formulas;
    tools: typeof tools;
    mail: typeof mail;
    shell: typeof shell;
    ui: typeof ui;
    auth: typeof auth;
    setup: typeof setup;
    accounts: typeof accounts;
    assistant: typeof assistant;
  }
}
