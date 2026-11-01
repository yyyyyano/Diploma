// Словари (NFR-19): ru — единственный язык MVP, be — задел. Типы ключей i18next берёт отсюда (ResourceNamespaceMap
// — способ i18next для пакета монорепозитория): несуществующий ключ не компилируется ни здесь, ни на сайте.
import { accounts } from "./locales/ru/accounts.ts";
import type { admin } from "./locales/ru/admin.ts";
import type { assistant } from "./locales/ru/assistant.ts";
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
import { recurring } from "./locales/ru/recurring.ts";
import { budget } from "./locales/ru/budget.ts";
import { dashboard } from "./locales/ru/dashboard.ts";
import { laws } from "./locales/ru/laws.ts";
import type { agent } from "./locales/ru/agent.ts";
import type { legal } from "./locales/ru/legal.ts";
import type { xls } from "./locales/ru/xls.ts";
import type { rates } from "./locales/ru/rates.ts";
import type { weekly } from "./locales/ru/weekly.ts";
import type { telegram } from "./locales/ru/telegram.ts";
import type { afford } from "./locales/ru/afford.ts";
import type { calendar } from "./locales/ru/calendar.ts";
import type { deductions } from "./locales/ru/deductions.ts";

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
  "mailbox",
  "settings",
  "decisions",
  "notifications",
  "profile",
  "categories",
  "operations",
  "documents",
  "recurring",
  "budget",
  "dashboard",
  "laws",
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
    mailbox,
    settings,
    decisions,
    notifications,
    profile,
    categories,
    operations,
    documents,
    recurring,
    budget,
    dashboard,
    laws,
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
    mailbox: typeof mailbox;
    settings: typeof settings;
    profile: typeof profile;
    categories: typeof categories;
    operations: typeof operations;
    documents: typeof documents;
    recurring: typeof recurring;
    budget: typeof budget;
    dashboard: typeof dashboard;
    laws: typeof laws;
    decisions: typeof decisions;
    notifications: typeof notifications;
    // Подгружается с администрированием (adminTexts), в `resources` не входит: бюджет первой загрузки сайта (T-043).
    admin: typeof admin;
    // Подгружается с чатом (assistantTexts), в `resources` не входит: бюджет первой загрузки сайта (T-043).
    assistant: typeof assistant;
    // Подгружается со страницей «Таблицы ставок» (ratesTexts), в `resources` не входит: бюджет первой загрузки сайта.
    rates: typeof rates;
    // Подгружается со страницей «Налоговые вычеты» и карточкой расчёта в чате (deductionsTexts), в `resources` не входит.
    deductions: typeof deductions;
    // Подгружается со страницей «Календарь», карточкой события в чате и блоком на главной (calendarTexts), в `resources` не входит.
    calendar: typeof calendar;
    // Подгружается со страницей «Могу ли я позволить покупку?», карточкой сценариев в чате и карточкой главной (affordTexts), в `resources` не входит.
    afford: typeof afford;
    // Подгружается с карточкой «Итоги недели» и настройками (weeklyTexts), серверу — `createWeeklyT`; в `resources` не входит.
    weekly: typeof weekly;
    // Только серверу (бот, `createTelegramT`) и вкладке «Telegram» настроек (telegramTexts); в `resources` не входит.
    telegram: typeof telegram;
    // Только серверу (`createLegalT`): тексты под правовым ответом; сайт словарь не грузит.
    legal: typeof legal;
    // Только серверу (`createXlsT`): листы и шапки файла Excel; сайт словарь не грузит.
    xls: typeof xls;
    // Только серверу (`createAgentT`): отказы стражей, пометки о числах и пределе шагов; сайт словарь не грузит.
    agent: typeof agent;
  }
}
