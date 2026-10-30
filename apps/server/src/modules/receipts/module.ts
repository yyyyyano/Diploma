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
import { makeRecognize } from "./application/recognize.ts";
import { receiptsNeedsReview, receiptsRecognized } from "./events.ts";
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
    preparer,
    jobs: { recognize },
  });
  return defineModule({
    id: "receipts",
    facade: { start: flow.start },
    events: [receiptsRecognized, receiptsNeedsReview],
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

/** Что модуль даёт соседям: `start(s, fileId)` — чек «распознаётся» и задача receipts.recognize (загрузка и экран — T-028). */
export type ReceiptsFacade = ReturnType<typeof createReceiptsModule>["facade"];
