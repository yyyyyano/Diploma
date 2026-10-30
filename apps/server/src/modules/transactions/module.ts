// Модуль transactions (паспорт — CLAUDE.md): операции — таблица, ручной ввод и правка с «Отменить», удаление после «Да»,
// инструменты агента (TXN-01…05, FIN-01, STMT-02, STMT-09). Остаток счёта пересчитывает фасад accounts; курс НБРБ
// и категорию «по умолчанию» доопределяют фоновые задачи.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import type { FxRatesFacade } from "../fx-rates/index.ts";
import type { MerchantsFacade } from "../merchants/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import { transactionsTools } from "./agent/tools.ts";
import { transactionsRouter } from "./api/router.ts";
import { makeImportBatch } from "./application/import-batch.ts";
import { makeBase, makeOperations } from "./application/operations.ts";
import {
  APPLY_RULE_HANDLER,
  CATEGORY_HANDLER,
  DELETE_HANDLER,
  MATCH_HANDLER,
  REMERGE_HANDLER,
  RESTORE_HANDLER,
  TRANSFER_HANDLER,
  UNMERGE_HANDLER,
} from "./application/handlers.ts";
import { transactionsChanged, transactionsMerged } from "./events.ts";
import { MATCH_AMOUNT_TOLERANCE_MINOR, MATCH_SIMILARITY, MATCH_WINDOW_DAYS } from "./settings.ts";
import { categorizeJob } from "./jobs/categorize.job.ts";
import { fillRatesJob } from "./jobs/fill-rates.job.ts";
import { countEditedInImport } from "./infrastructure/db/transactions.repo.ts";
import { transactionsUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface TransactionsFacades {
  readonly accounts: AccountsFacade;
  readonly categories: CategoriesFacade;
  readonly merchants: MerchantsFacade;
  readonly fxRates: FxRatesFacade;
  readonly actions: ActionsFacade;
  readonly explain: ExplainFacade;
  readonly notifications: NotificationsFacade;
}

export function createTransactionsModule({
  platform,
  facades,
}: ModuleDeps<TransactionsFacades, Platform>) {
  const deps = {
    platform,
    accounts: facades.accounts,
    categories: facades.categories,
    merchants: facades.merchants,
    fxRates: facades.fxRates,
    actions: facades.actions,
    explain: facades.explain,
    notifications: facades.notifications,
    settings: platform.settings,
  };
  const base = makeBase(deps);
  const jobs = {
    fillRates: fillRatesJob(base.background.fillRates),
    categorize: categorizeJob(base.background.categorizeFallback),
  };
  const ops = makeOperations(deps, base, jobs);
  const imports = makeImportBatch(deps, { prepare: base.prepare, ledger: base.ledger, jobs });
  const tools = transactionsTools(ops);
  return defineModule({
    id: "transactions",
    facade: {
      importBatch: imports.importBatch,
      deleteImport: imports.deleteImport,
      knownKeys: imports.knownKeys,
      transferCandidates: imports.transferCandidates,
      purchaseCandidates: imports.purchaseCandidates,
      countEditedInImport,
      requestMarkTransfer: ops.requestMarkTransfer,
      recordFromReceipt: ops.recordFromReceipt,
      updateFromReceipt: ops.updateFromReceipt,
      setReceiptReviewed: ops.setReceiptReviewed,
      removeForReceipt: ops.removeForReceipt,
      operationOfReceipt: ops.operationOfReceipt,
      matchReceipt: ops.matchReceipt,
      matchBankOps: ops.matchBankOps,
    },
    router: transactionsRouter(ops),
    events: [transactionsChanged, transactionsMerged],
    settings: [MATCH_WINDOW_DAYS, MATCH_AMOUNT_TOLERANCE_MINOR, MATCH_SIMILARITY],
    jobs: [jobs.fillRates, jobs.categorize],
    tools: [tools.search, tools.add, tools.update, tools.changeCategory, tools.remove],
    undo: {
      [RESTORE_HANDLER]: ops.restore,
      [UNMERGE_HANDLER]: ops.undoMerge,
      [REMERGE_HANDLER]: ops.undoUnlink,
    },
    confirm: {
      [DELETE_HANDLER]: ops.confirmDelete,
      [CATEGORY_HANDLER]: ops.confirmChangeCategory,
      [TRANSFER_HANDLER]: ops.confirmMarkTransfer,
      [APPLY_RULE_HANDLER]: ops.confirmApplyRule,
      [MATCH_HANDLER]: ops.confirmMatch,
    },
    userData: transactionsUserData,
  });
}

/**
 * Что модуль даёт соседям: запись выписки (T-026) — `importBatch(tx, { importId, rows })`, `deleteImport(tx, importId)`,
 * проверка дублей `knownKeys`, кандидаты в пару перевода и покупки возврата, `countEditedInImport`,
 * `requestMarkTransfer(s, ids, channel)` — «Да/Нет» для спорных переводов; чеки (T-028): `recordFromReceipt`,
 * `updateFromReceipt`, `setReceiptReviewed`, `removeForReceipt`, `operationOfReceipt`; агрегаты пачками — T-031.
 */
export type TransactionsFacade = ReturnType<typeof createTransactionsModule>["facade"];
