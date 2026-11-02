// Модуль receipts (паспорт — CLAUDE.md): распознавание чека (T-027) — QR и дубли, подготовка фото в изолированном
// потоке, извлечение моделью, арифметический валидатор (calc), перепроверка спорных строк, позиции и история попыток.
// Загрузка, учёт в операциях, карточка и экран — T-028.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { FilesFacade } from "../files/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { MerchantsFacade } from "../merchants/index.ts";
import type { LlmFacade } from "../llm/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import type { ScopedDb } from "../../platform/db/scoped-db.ts";
import { findReceipts, warrantyItemsOf } from "./infrastructure/db/receipts.repo.ts";
import { makeRecognize } from "./application/recognize.ts";
import { makeRecordReady } from "./application/record-ready.ts";
import { makeReview } from "./application/review.ts";
import { receiptsTools } from "./agent/tools.ts";
import { receiptsRouter } from "./api/router.ts";
import { receiptsNeedsReview, receiptsRecognized, receiptsWarrantyItemsFound } from "./events.ts";
import { makePhotoPreparer } from "./infrastructure/image/prepare-photo.ts";
import { recognizeJob } from "./jobs/recognize.job.ts";
import {
  RECEIPTS_IMAGE_MAX_SIDE,
  RECEIPTS_MAX_RECHECKS,
  RECEIPTS_PREPARE_MEMORY_MB,
  RECEIPTS_PREPARE_TIMEOUT_MS,
  RECEIPTS_TOLERANCE_MINOR,
} from "./settings.ts";
import { receiptsUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface ReceiptsFacades {
  readonly files: FilesFacade;
  readonly transactions: TransactionsFacade;
  readonly categories: CategoriesFacade;
  readonly merchants: MerchantsFacade;
  readonly llm: LlmFacade;
  readonly actions: ActionsFacade;
  readonly notifications: NotificationsFacade;
  readonly explain: ExplainFacade;
}

export function createReceiptsModule({ platform, facades }: ModuleDeps<ReceiptsFacades, Platform>) {
  // Подготовка фото — в потоке с таймаутом и лимитом памяти из настроек (SEC-03).
  const preparer = makePhotoPreparer(async () => ({
    timeoutMs: await platform.settings.get(RECEIPTS_PREPARE_TIMEOUT_MS),
    memoryMb: await platform.settings.get(RECEIPTS_PREPARE_MEMORY_MB),
  }));
  // Задаче нужен сценарий, а сценарию — ссылка на задачу: связываем замыканием, вызов — уже после сборки.
  const recognize = recognizeJob((s, receiptId) => flow.run(s, receiptId));
  const flow = makeRecognize({
    platform,
    files: facades.files,
    llm: facades.llm,
    merchants: facades.merchants,
    explain: facades.explain,
    categories: facades.categories,
    transactions: facades.transactions,
    notifications: facades.notifications,
    preparer,
    jobs: { recognize },
  });
  const review = makeReview({
    platform,
    files: facades.files,
    categories: facades.categories,
    explain: facades.explain,
    merchants: facades.merchants,
    transactions: facades.transactions,
  });
  const recordReady = makeRecordReady({
    platform,
    merchants: facades.merchants,
    transactions: facades.transactions,
    settle: flow.settle,
  });
  const tools = receiptsTools(review);
  return defineModule({
    id: "receipts",
    facade: {
      start: flow.start,
      // CAL-04: позиции с гарантией для календаря (чеки по списку; пусто — все чеки пользователя).
      warrantyItems: (s: ScopedDb, receiptIds: readonly string[]) => warrantyItemsOf(s, receiptIds),
      // CHAT-03: какие из id — чеки этого домохозяйства (чужие и удалённые не попадают в список).
      existing: async (s: ScopedDb, ids: readonly string[]): Promise<readonly string[]> =>
        (await findReceipts(s, ids)).map((row) => row.id),
      // TG-03: карточка чека и кнопки «Верно» / «Отменить» бота — те же сценарии, что у процедур сайта; чужой id — NOT_FOUND.
      card: review.get,
      confirm: review.confirm,
      cancel: review.cancel,
      // DEMO-01: готовое чтение чека без модели — тот же валидатор, перепроверка, операция и события, что у распознанного чека.
      recordReady,
    },
    router: receiptsRouter(flow, review),
    tools: [tools.get, tools.status],
    events: [receiptsRecognized, receiptsNeedsReview, receiptsWarrantyItemsFound],
    jobs: [recognize],
    settings: [
      RECEIPTS_TOLERANCE_MINOR,
      RECEIPTS_MAX_RECHECKS,
      RECEIPTS_PREPARE_TIMEOUT_MS,
      RECEIPTS_PREPARE_MEMORY_MB,
      RECEIPTS_IMAGE_MAX_SIDE,
    ],
    userData: receiptsUserData,
  });
}

/** Что модуль даёт соседям: `start(s, fileId)` — чек «распознаётся» и задача receipts.recognize; `warrantyItems(s, receiptIds)` — позиции с гарантией (CAL-04); `existing(s, ids)` — id своих чеков (CHAT-03); `recordReady(s, { fileId, reading, rechecks, categories })` — готовое чтение без модели (DEMO-01). */
export type ReceiptsFacade = ReturnType<typeof createReceiptsModule>["facade"];
