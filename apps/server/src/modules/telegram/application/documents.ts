// Фото чека и файл выписки из бота (TG-03, TG-04, SEC-03): файл принимает единый вход `files` (тип по содержимому, белый
// список, лимиты), дальше — те же конвейеры, что на сайте. Карточку чека присылает подписка на `receipts.recognized` /
// `receipts.needs-review` (воркер) или, если сбой, сам бот по ожиданию; кто первым забрал строку `telegram_receipt_cards`, тот
// и отправил — повтора нет. Выписка разбирается в worker без события: бот проверяет готовность с паузой.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { encodeCallback } from "../domain/callback-data.ts";
import { failedReceiptText, receiptCardText, statementPreviewText } from "../domain/format.ts";
import { addReceiptCard, claimReceiptCard } from "../infrastructure/db/telegram.repo.ts";
import { DOCUMENT_WAIT_SEC, MAX_FILE_MB } from "../settings.ts";
import type { TelegramDeps } from "./deps.ts";
import type { BotApi, Keyboard, Origin, Sender } from "./ports.ts";

/** Шаг проверки готовности чека или выписки, мс. */
const POLL_STEP_MS = 2_000;

export interface FileInput {
  readonly fileId: string;
  readonly name: string;
  readonly size: number | undefined;
}

export function makeDocuments(d: TelegramDeps, spawn: (work: () => Promise<void>) => void) {
  const { t, system, platform, neighbours } = d;

  async function fetchFile(file: FileInput, api: BotApi): Promise<Uint8Array> {
    const maxMb = await platform.settings.get(MAX_FILE_MB);
    return api.download(file.fileId, maxMb * 1024 * 1024, file.size);
  }

  /** Фото (или документ-картинка) → чек: приём, распознавание в worker, ожидание карточки. */
  async function acceptReceipt(
    s: ScopedDb,
    origin: Origin,
    file: FileInput,
    api: BotApi,
  ): Promise<void> {
    const content = await fetchFile(file, api);
    const [accepted] = await neighbours.files.accept(s, "receipt-photo", [
      { name: file.name, content },
    ]);
    if (accepted === undefined) throw new AppError("UNAVAILABLE");
    const { id } = await neighbours.receipts.start(s, accepted.id as never);
    await addReceiptCard(system, {
      receiptId: id,
      householdId: s.scope.householdId,
      chatId: origin.chatId,
      at: platform.clock.now(),
    });
    await api.send(origin.chatId, t("bot.receipt.received"));
    // Страховка к подписке: чек со сбоем («не вышло») события не публикует — бот дожидается итога сам.
    spawn(() => waitReceipt(s, id, api));
  }

  async function waitReceipt(s: ScopedDb, receiptId: string, api: Sender): Promise<void> {
    const steps = Math.ceil(
      ((await platform.settings.get(DOCUMENT_WAIT_SEC)) * 1000) / POLL_STEP_MS,
    );
    for (let step = 0; step < steps; step += 1) {
      if (await deliverReceipt(s, receiptId, api)) return;
      await d.sleep(POLL_STEP_MS);
    }
  }

  /**
   * Прислать карточку чека, если он готов и карточка ещё не уходила. `false` — ещё распознаётся (или уже отправлена).
   * Зовёт и подписка воркера, и ожидание бота.
   */
  async function deliverReceipt(s: ScopedDb, receiptId: string, api: Sender): Promise<boolean> {
    let card;
    try {
      card = await neighbours.receipts.card(s, receiptId as never);
    } catch (error) {
      if (error instanceof AppError && error.code === "NOT_FOUND") return true;
      throw error;
    }
    if (card.receipt.status === "processing") return false;
    const chatId = await claimReceiptCard(
      system,
      receiptId,
      s.scope.householdId,
      platform.clock.now(),
    );
    if (chatId === undefined) return true;
    if (card.receipt.status === "failed") {
      await api.send(chatId, failedReceiptText(t, card));
      return true;
    }
    const keyboard: Keyboard = [
      [
        {
          text: t("bot.buttons.receiptOk"),
          data: encodeCallback({ action: "receipt-confirm", id: receiptId }),
        },
        {
          text: t("bot.buttons.receiptEdit"),
          data: encodeCallback({ action: "receipt-edit", id: receiptId }),
        },
        {
          text: t("bot.buttons.receiptCancel"),
          data: encodeCallback({ action: "receipt-cancel", id: receiptId }),
        },
      ],
    ];
    await api.send(chatId, receiptCardText(t, card), keyboard);
    return true;
  }

  /** Файл выписки → импорт: приём, разбор в worker, предпросмотр «Найдено N… Импортировать M?». */
  async function acceptStatement(
    s: ScopedDb,
    origin: Origin,
    file: FileInput,
    api: BotApi,
  ): Promise<void> {
    const content = await fetchFile(file, api);
    const [accepted] = await neighbours.files.accept(s, "statement", [
      { name: file.name, content },
    ]);
    if (accepted === undefined) throw new AppError("UNAVAILABLE");
    const { id } = await neighbours.statements.start(s, accepted.id as never);
    await api.send(origin.chatId, t("bot.statement.received"));
    spawn(() => waitStatement(s, origin.chatId, id, api));
  }

  async function waitStatement(
    s: ScopedDb,
    chatId: number,
    importId: string,
    api: BotApi,
  ): Promise<void> {
    const steps = Math.ceil(
      ((await platform.settings.get(DOCUMENT_WAIT_SEC)) * 1000) / POLL_STEP_MS,
    );
    for (let step = 0; step < steps; step += 1) {
      const summary = await neighbours.statements.summary(s, importId);
      if (summary.status === "failed") {
        await api.send(chatId, t("bot.statement.failed"));
        return;
      }
      if (summary.status !== "parsing") {
        const keyboard: Keyboard =
          summary.newCount === 0
            ? []
            : [
                [
                  {
                    text: t("bot.buttons.statementImport", { count: summary.newCount }),
                    data: encodeCallback({ action: "statement-import", id: importId }),
                  },
                  {
                    text: t("bot.buttons.statementCancel"),
                    data: encodeCallback({ action: "statement-cancel", id: importId }),
                  },
                ],
              ];
        await api.send(chatId, statementPreviewText(t, summary), keyboard);
        return;
      }
      await d.sleep(POLL_STEP_MS);
    }
    await api.send(chatId, t("bot.statement.failed"));
  }

  return { acceptReceipt, acceptStatement, deliverReceipt };
}

export type Documents = ReturnType<typeof makeDocuments>;
