// Сборка модулей корня композиции (ARCHITECTURE §3): порядок — топологическая сортировка
// tooling/architecture/modules.ts, фасады — ровно dependsOn модуля, SystemPlatform (с SystemDb) — только модулям с
// таблицами system/public. Файл генерирует make new-module — руками не править; сверку с картой делает
// create-modules.test.ts.
import type {
  ModuleDescriptor,
  Platform,
  SystemPlatform,
} from "../platform/module/define-module.ts";
import { createFilesModule } from "../modules/files/index.ts";
import { createExplainModule } from "../modules/explain/index.ts";
import { createActionsModule } from "../modules/actions/index.ts";
import { createPrivacyModule } from "../modules/privacy/index.ts";
import { createMailModule } from "../modules/mail/index.ts";
import { createIdentityModule } from "../modules/identity/index.ts";
import { createNotificationsModule } from "../modules/notifications/index.ts";
import { createLlmModule } from "../modules/llm/index.ts";
import { createSystemModule } from "../modules/system/index.ts";
import { createProfileModule } from "../modules/profile/index.ts";
import { createFxRatesModule } from "../modules/fx-rates/index.ts";
import { createMerchantsModule } from "../modules/merchants/index.ts";
import { createCategoriesModule } from "../modules/categories/index.ts";
import { createAccountsModule } from "../modules/accounts/index.ts";
import { createTransactionsModule } from "../modules/transactions/index.ts";
import { createStatementsModule } from "../modules/statements/index.ts";
import { createReceiptsModule } from "../modules/receipts/index.ts";
import { createRecurringModule } from "../modules/recurring/index.ts";
import { createLegalBaseModule } from "../modules/legal-base/index.ts";
import { createNormTablesModule } from "../modules/norm-tables/index.ts";
import { createLegalConsultModule } from "../modules/legal-consult/index.ts";
import { createFinModule } from "../modules/fin/index.ts";
import { createBudgetsModule } from "../modules/budgets/index.ts";
import { createCalendarModule } from "../modules/calendar/index.ts";
import { createTaxModule } from "../modules/tax/index.ts";
import { createAffordModule } from "../modules/afford/index.ts";
import { createWeeklyModule } from "../modules/weekly/index.ts";
import { createDashboardModule } from "../modules/dashboard/index.ts";
import { createXlsExportModule } from "../modules/xls-export/index.ts";
import { createVoiceModule } from "../modules/voice/index.ts";
import { createAgentModule } from "../modules/agent/index.ts";
import { createChatModule } from "../modules/chat/index.ts";
import { createTelegramModule } from "../modules/telegram/index.ts";
import { createDemoModule } from "../modules/demo/index.ts";
import { createQualityModule } from "../modules/quality/index.ts";
import { createAdminModule } from "../modules/admin/index.ts";

/** Порты платформы: SystemPlatform отличается только SystemDb. */
export interface ModulePorts {
  readonly platform: Platform;
  readonly systemPlatform: SystemPlatform;
}

export function createModules(ports: ModulePorts): readonly ModuleDescriptor[] {
  const filesModule = createFilesModule({
    platform: ports.platform,
    facades: {},
  });
  const explainModule = createExplainModule({
    platform: ports.platform,
    facades: {},
  });
  const actionsModule = createActionsModule({
    platform: ports.platform,
    facades: {},
  });
  const privacyModule = createPrivacyModule({
    platform: ports.systemPlatform,
    facades: { files: filesModule.facade },
  });
  const mailModule = createMailModule({
    platform: ports.systemPlatform,
    facades: {},
  });
  const identityModule = createIdentityModule({
    platform: ports.systemPlatform,
    facades: { mail: mailModule.facade, privacy: privacyModule.facade },
  });
  const notificationsModule = createNotificationsModule({
    platform: ports.systemPlatform,
    facades: { identity: identityModule.facade, privacy: privacyModule.facade },
  });
  const llmModule = createLlmModule({
    platform: ports.systemPlatform,
    facades: {
      privacy: privacyModule.facade,
      identity: identityModule.facade,
      notifications: notificationsModule.facade,
    },
  });
  const systemModule = createSystemModule({
    platform: ports.systemPlatform,
    facades: {},
  });
  const profileModule = createProfileModule({
    platform: ports.platform,
    facades: { identity: identityModule.facade, actions: actionsModule.facade },
  });
  const fxRatesModule = createFxRatesModule({
    platform: ports.systemPlatform,
    facades: { explain: explainModule.facade },
  });
  const merchantsModule = createMerchantsModule({
    platform: ports.systemPlatform,
    facades: { llm: llmModule.facade },
  });
  const categoriesModule = createCategoriesModule({
    platform: ports.systemPlatform,
    facades: { merchants: merchantsModule.facade, llm: llmModule.facade },
  });
  const accountsModule = createAccountsModule({
    platform: ports.platform,
    facades: {
      identity: identityModule.facade,
      fxRates: fxRatesModule.facade,
      explain: explainModule.facade,
      actions: actionsModule.facade,
    },
  });
  const transactionsModule = createTransactionsModule({
    platform: ports.platform,
    facades: {
      accounts: accountsModule.facade,
      categories: categoriesModule.facade,
      merchants: merchantsModule.facade,
      fxRates: fxRatesModule.facade,
      actions: actionsModule.facade,
      explain: explainModule.facade,
      notifications: notificationsModule.facade,
    },
  });
  const statementsModule = createStatementsModule({
    platform: ports.platform,
    facades: {
      files: filesModule.facade,
      accounts: accountsModule.facade,
      transactions: transactionsModule.facade,
      categories: categoriesModule.facade,
      merchants: merchantsModule.facade,
      fxRates: fxRatesModule.facade,
      llm: llmModule.facade,
      actions: actionsModule.facade,
      notifications: notificationsModule.facade,
    },
  });
  const receiptsModule = createReceiptsModule({
    platform: ports.platform,
    facades: {
      files: filesModule.facade,
      transactions: transactionsModule.facade,
      categories: categoriesModule.facade,
      merchants: merchantsModule.facade,
      llm: llmModule.facade,
      actions: actionsModule.facade,
      notifications: notificationsModule.facade,
      explain: explainModule.facade,
    },
  });
  const recurringModule = createRecurringModule({
    platform: ports.platform,
    facades: {
      transactions: transactionsModule.facade,
      categories: categoriesModule.facade,
      profile: profileModule.facade,
      notifications: notificationsModule.facade,
      actions: actionsModule.facade,
      explain: explainModule.facade,
    },
  });
  const legalBaseModule = createLegalBaseModule({
    platform: ports.systemPlatform,
    facades: {
      llm: llmModule.facade,
      notifications: notificationsModule.facade,
      identity: identityModule.facade,
    },
  });
  const normTablesModule = createNormTablesModule({
    platform: ports.systemPlatform,
    facades: { legalBase: legalBaseModule.facade, notifications: notificationsModule.facade },
  });
  const legalConsultModule = createLegalConsultModule({
    platform: ports.platform,
    facades: { legalBase: legalBaseModule.facade, normTables: normTablesModule.facade },
  });
  const finModule = createFinModule({
    platform: ports.platform,
    facades: {
      accounts: accountsModule.facade,
      transactions: transactionsModule.facade,
      recurring: recurringModule.facade,
      profile: profileModule.facade,
      explain: explainModule.facade,
    },
  });
  const budgetsModule = createBudgetsModule({
    platform: ports.platform,
    facades: {
      accounts: accountsModule.facade,
      transactions: transactionsModule.facade,
      categories: categoriesModule.facade,
      fin: finModule.facade,
      notifications: notificationsModule.facade,
      actions: actionsModule.facade,
      explain: explainModule.facade,
    },
  });
  const taxModule = createTaxModule({
    platform: ports.platform,
    facades: {
      profile: profileModule.facade,
      transactions: transactionsModule.facade,
      categories: categoriesModule.facade,
      normTables: normTablesModule.facade,
      legalBase: legalBaseModule.facade,
      legalConsult: legalConsultModule.facade,
      notifications: notificationsModule.facade,
      actions: actionsModule.facade,
      explain: explainModule.facade,
    },
  });
  const calendarModule = createCalendarModule({
    platform: ports.platform,
    facades: {
      profile: profileModule.facade,
      transactions: transactionsModule.facade,
      recurring: recurringModule.facade,
      receipts: receiptsModule.facade,
      normTables: normTablesModule.facade,
      notifications: notificationsModule.facade,
      actions: actionsModule.facade,
      explain: explainModule.facade,
      tax: taxModule.facade,
    },
  });
  const affordModule = createAffordModule({
    platform: ports.platform,
    facades: {
      accounts: accountsModule.facade,
      transactions: transactionsModule.facade,
      recurring: recurringModule.facade,
      fin: finModule.facade,
      budgets: budgetsModule.facade,
      calendar: calendarModule.facade,
      normTables: normTablesModule.facade,
      profile: profileModule.facade,
      explain: explainModule.facade,
    },
  });
  const weeklyModule = createWeeklyModule({
    platform: ports.platform,
    facades: {
      transactions: transactionsModule.facade,
      budgets: budgetsModule.facade,
      calendar: calendarModule.facade,
      categories: categoriesModule.facade,
      recurring: recurringModule.facade,
      tax: taxModule.facade,
      llm: llmModule.facade,
      notifications: notificationsModule.facade,
      explain: explainModule.facade,
      identity: identityModule.facade,
    },
  });
  const dashboardModule = createDashboardModule({
    platform: ports.platform,
    facades: {
      accounts: accountsModule.facade,
      transactions: transactionsModule.facade,
      fin: finModule.facade,
      budgets: budgetsModule.facade,
      recurring: recurringModule.facade,
      calendar: calendarModule.facade,
      tax: taxModule.facade,
      weekly: weeklyModule.facade,
      explain: explainModule.facade,
    },
  });
  const xlsExportModule = createXlsExportModule({
    platform: ports.platform,
    facades: {
      transactions: transactionsModule.facade,
      categories: categoriesModule.facade,
      budgets: budgetsModule.facade,
      accounts: accountsModule.facade,
    },
  });
  const voiceModule = createVoiceModule({
    platform: ports.platform,
    facades: { llm: llmModule.facade },
  });
  const agentModule = createAgentModule({
    platform: ports.platform,
    facades: {
      llm: llmModule.facade,
      actions: actionsModule.facade,
      profile: profileModule.facade,
      legalConsult: legalConsultModule.facade,
    },
  });
  const chatModule = createChatModule({
    platform: ports.platform,
    facades: {
      agent: agentModule.facade,
      files: filesModule.facade,
      receipts: receiptsModule.facade,
      statements: statementsModule.facade,
      voice: voiceModule.facade,
      legalBase: legalBaseModule.facade,
      legalConsult: legalConsultModule.facade,
    },
  });
  const telegramModule = createTelegramModule({
    platform: ports.systemPlatform,
    facades: {
      files: filesModule.facade,
      llm: llmModule.facade,
      categories: categoriesModule.facade,
      chat: chatModule.facade,
      agent: agentModule.facade,
      identity: identityModule.facade,
      privacy: privacyModule.facade,
      notifications: notificationsModule.facade,
      actions: actionsModule.facade,
      receipts: receiptsModule.facade,
      statements: statementsModule.facade,
      voice: voiceModule.facade,
      dashboard: dashboardModule.facade,
      budgets: budgetsModule.facade,
      weekly: weeklyModule.facade,
    },
  });
  const demoModule = createDemoModule({
    platform: ports.platform,
    facades: {
      identity: identityModule.facade,
      privacy: privacyModule.facade,
      profile: profileModule.facade,
      files: filesModule.facade,
      accounts: accountsModule.facade,
      transactions: transactionsModule.facade,
      receipts: receiptsModule.facade,
      categories: categoriesModule.facade,
      recurring: recurringModule.facade,
      budgets: budgetsModule.facade,
      calendar: calendarModule.facade,
      weekly: weeklyModule.facade,
    },
  });
  const qualityModule = createQualityModule({
    platform: ports.systemPlatform,
    facades: {
      llm: llmModule.facade,
      receipts: receiptsModule.facade,
      statements: statementsModule.facade,
      categories: categoriesModule.facade,
      legalBase: legalBaseModule.facade,
      legalConsult: legalConsultModule.facade,
      agent: agentModule.facade,
    },
  });
  const adminModule = createAdminModule({
    platform: ports.platform,
    facades: {
      identity: identityModule.facade,
      privacy: privacyModule.facade,
      notifications: notificationsModule.facade,
      mail: mailModule.facade,
      llm: llmModule.facade,
      legalBase: legalBaseModule.facade,
      normTables: normTablesModule.facade,
      system: systemModule.facade,
      telegram: telegramModule.facade,
      quality: qualityModule.facade,
      demo: demoModule.facade,
    },
  });
  return [
    filesModule,
    explainModule,
    actionsModule,
    privacyModule,
    mailModule,
    identityModule,
    notificationsModule,
    llmModule,
    systemModule,
    profileModule,
    fxRatesModule,
    merchantsModule,
    categoriesModule,
    accountsModule,
    transactionsModule,
    statementsModule,
    receiptsModule,
    recurringModule,
    legalBaseModule,
    normTablesModule,
    legalConsultModule,
    finModule,
    budgetsModule,
    taxModule,
    calendarModule,
    affordModule,
    weeklyModule,
    dashboardModule,
    xlsExportModule,
    voiceModule,
    agentModule,
    chatModule,
    telegramModule,
    demoModule,
    qualityModule,
    adminModule,
  ];
}
