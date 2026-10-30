// Словари (NFR-19): ru — единственный язык MVP, be — задел. Типы ключей i18next берёт отсюда (ResourceNamespaceMap
// — способ i18next для пакета монорепозитория): несуществующий ключ не компилируется ни здесь, ни на сайте.
import { accounts } from "./locales/ru/accounts.ts";
import { admin } from "./locales/ru/admin.ts";
import { assistant } from "./locales/ru/assistant.ts";
import { auth } from "./locales/ru/auth.ts";
import { common } from "./locales/ru/common.ts";
import { decisions } from "./locales/ru/decisions.ts";
import { notifications } from "./locales/ru/notifications.ts";
import { errors } from "./locales/ru/errors.ts";
import { formulas } from "./locales/ru/formulas.ts";
import { mail } from "./locales/ru/mail.ts";
import { policy } from "./locales/ru/policy.ts";
import { setup } from "./locales/ru/setup.ts";
import { shell } from "./locales/ru/shell.ts";
import { tools } from "./locales/ru/tools.ts";
import { ui } from "./locales/ru/ui.ts";
import { mailbox } from "./locales/ru/mailbox.ts";
import { settings } from "./locales/ru/settings.ts";
import { profile } from "./locales/ru/profile.ts";
import { categories } from "./locales/ru/categories.ts";
import { operations } from "./locales/ru/operations.ts";
import { documents } from "./locales/ru/documents.ts";

export const NAMESPACES = [
  "common",
  "errors",
  "formulas",
  "tools",
  "mail",
  "policy",
  "shell",
  "ui",
  "auth",
  "setup",
  "accounts",
  "assistant",
  "mailbox",
  "settings",
  "decisions",
  "notifications",
  "admin",
  "profile",
  "categories",
  "operations",
  "documents",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export const LANGUAGES = ["ru"] as const;

export type Language = (typeof LANGUAGES)[number];

export const resources = {
  ru: {
    common,
    errors,
    formulas,
    tools,
    mail,
    policy,
    shell,
    ui,
    auth,
    setup,
    accounts,
    assistant,
    mailbox,
    settings,
    decisions,
    notifications,
    admin,
    profile,
    categories,
    operations,
    documents,
  },
} as const satisfies Record<Language, Record<Namespace, object>>;

declare module "i18next" {
  interface ResourceNamespaceMap {
    common: typeof common;
    errors: typeof errors;
    formulas: typeof formulas;
    tools: typeof tools;
    mail: typeof mail;
    policy: typeof policy;
    shell: typeof shell;
    ui: typeof ui;
    auth: typeof auth;
    setup: typeof setup;
    accounts: typeof accounts;
    assistant: typeof assistant;
    mailbox: typeof mailbox;
    settings: typeof settings;
    admin: typeof admin;
    profile: typeof profile;
    categories: typeof categories;
    operations: typeof operations;
    documents: typeof documents;
    decisions: typeof decisions;
    notifications: typeof notifications;
  }
}
