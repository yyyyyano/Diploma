// Публичный API @kosht/i18n — тексты и форматы (паспорт — packages/i18n/CLAUDE.md).
export { createT, type T } from "./create-t.ts";
export { formatDate, formatRelativeDay } from "./format-date.ts";
export { formatFileSize } from "./format-file-size.ts";
export { formatMoney, formatMoneyParts, type MoneyParts } from "./format-money.ts";
export { parseMoney } from "./parse-money.ts";
export { CONSENT_VERSIONS } from "./locales/ru/policy.ts";
export { LANGUAGES, NAMESPACES, resources, type Language, type Namespace } from "./resources.ts";
