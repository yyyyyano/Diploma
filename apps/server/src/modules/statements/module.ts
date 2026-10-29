// Модуль statements (паспорт — CLAUDE.md): разбор выписок любого банка (T-025) — чтение PDF/XLSX/XLS/CSV/сканов в
// изолированном потоке, колонки (запомненный формат → эвристика → модель), сверка остатков, запоминание формата.
// Предпросмотр, дубли, типы, импорт и откат — T-026.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { FilesFacade } from "../files/index.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { MerchantsFacade } from "../merchants/index.ts";
import type { FxRatesFacade } from "../fx-rates/index.ts";
import type { LlmFacade } from "../llm/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import { makeParseStatement } from "./application/parse-statement.ts";
import type { DocumentReader } from "./application/ports.ts";
import { makeRememberFormat } from "./application/remember-format.ts";
import { readDocument } from "./infrastructure/parsing/read-document.ts";
import {
  STATEMENTS_COLUMNS_SAMPLE_ROWS,
  STATEMENTS_PARSE_MEMORY_MB,
  STATEMENTS_PARSE_TIMEOUT_MS,
} from "./settings.ts";
import { statementsUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface StatementsFacades {
  readonly files: FilesFacade;
  readonly accounts: AccountsFacade;
  readonly transactions: TransactionsFacade;
  readonly categories: CategoriesFacade;
  readonly merchants: MerchantsFacade;
  readonly fxRates: FxRatesFacade;
  readonly llm: LlmFacade;
  readonly actions: ActionsFacade;
  readonly notifications: NotificationsFacade;
}

export function createStatementsModule({
  platform,
  facades,
}: ModuleDeps<StatementsFacades, Platform>) {
  // Чтение — в потоке с таймаутом и лимитом памяти из настроек (SEC-03).
  const reader: DocumentReader = {
    read: async (input) =>
      readDocument(input, {
        timeoutMs: await platform.settings.get(STATEMENTS_PARSE_TIMEOUT_MS),
        memoryMb: await platform.settings.get(STATEMENTS_PARSE_MEMORY_MB),
      }),
  };
  const { parseStatement, parseBytes } = makeParseStatement({
    reader,
    llm: facades.llm,
    files: facades.files,
    settings: platform.settings,
    log: platform.log,
  });
  const rememberFormat = makeRememberFormat(platform);
  return defineModule({
    id: "statements",
    facade: { parseStatement, parseBytes, rememberFormat },
    settings: [
      STATEMENTS_PARSE_TIMEOUT_MS,
      STATEMENTS_PARSE_MEMORY_MB,
      STATEMENTS_COLUMNS_SAMPLE_ROWS,
    ],
    userData: statementsUserData,
  });
}

/**
 * Что модуль даёт соседям: parseStatement(s, fileId) → ParsedStatement (чтение, колонки, сверка остатков),
 * parseBytes(s, { type, bytes }) — то же по байтам, rememberFormat(s, parsed) — запомнить формат после импорта.
 */
export type StatementsFacade = ReturnType<typeof createStatementsModule>["facade"];
