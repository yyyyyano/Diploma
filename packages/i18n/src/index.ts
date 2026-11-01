// Публичный API @kosht/i18n — тексты и форматы (паспорт — packages/i18n/CLAUDE.md).
export { createT, type T } from "./create-t.ts";
export { formatDate, formatRelativeDay } from "./format-date.ts";
export { formatDayTime, formatTime } from "./format-time.ts";
export { formatScaled } from "./format-decimal.ts";
export { formatFileSize } from "./format-file-size.ts";
export { formatMoney, formatMoneyParts, type MoneyParts } from "./format-money.ts";
export { parseMoney } from "./parse-money.ts";
export { CONSENT_VERSIONS } from "./locales/ru/policy.ts";
export { LANGUAGES, NAMESPACES, resources, type Language, type Namespace } from "./resources.ts";
// Словарь «Таблицы ставок»: не входит в `resources`, страница регистрирует его при показе (ленивый чанк сайта).
export { rates as ratesTexts } from "./locales/ru/rates.ts";
export { createTelegramT, type TelegramT } from "./create-telegram-t.ts";
export { telegram as telegramTexts } from "./locales/ru/telegram.ts";
export { createWeeklyT, type WeeklyT } from "./create-weekly-t.ts";
export { weekly as weeklyTexts } from "./locales/ru/weekly.ts";
export { afford as affordTexts } from "./locales/ru/afford.ts";
export { calendar as calendarTexts } from "./locales/ru/calendar.ts";
export { deductions as deductionsTexts } from "./locales/ru/deductions.ts";
export { admin as adminTexts } from "./locales/ru/admin.ts";
export { assistant as assistantTexts } from "./locales/ru/assistant.ts";
// Словарь правового консультанта: тексты под ответом собирает сервер (`legal-consult`); в `resources` его нет.
export { createLegalT, type LegalT } from "./create-legal-t.ts";
export { legal as legalTexts } from "./locales/ru/legal.ts";
// Словарь агента: отказы стражей и пометки пишет программа (`agent`); в `resources` его нет.
export { createAgentT, type AgentT } from "./create-agent-t.ts";
export { agent as agentTexts } from "./locales/ru/agent.ts";
// Словарь файла Excel: листы и шапки собирает сервер (`xls-export`); в `resources` его нет.
export { createXlsT, type XlsT } from "./create-xls-t.ts";
export { xls as xlsTexts } from "./locales/ru/xls.ts";
