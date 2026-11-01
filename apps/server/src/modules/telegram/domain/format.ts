// Тексты карточек бота (TG-03, TG-04): чек и выписка. Суммы и счётчики приходят готовыми от сервера (P1) — здесь только слова
// и формат; текст — через t() (NFR-19).
import type { ReceiptCard, ImportSummary } from "@kosht/contract";
import { formatMoney, type TelegramT } from "@kosht/i18n";

/** Карточка чека: «Евроопт · 10 позиций · 47,30 BYN ✓ сумма сходится» или «⚠ проверьте строки: 2, 5». */
export function receiptCardText(t: TelegramT, card: ReceiptCard): string {
  const { receipt } = card;
  const head = [
    receipt.storeName ?? t("bot.receipt.noStore"),
    t("bot.receipt.positions", { count: card.items.length }),
    ...(receipt.total === null ? [] : [formatMoney(receipt.total)]),
  ].join(" · ");
  if (receipt.status === "ok") return `${head} ✓ ${t("bot.receipt.matches")}`;
  const lines = receipt.disputedLines.join(", ");
  return `${head} ⚠ ${lines === "" ? t("bot.receipt.reviewGeneric") : t("bot.receipt.review", { lines })}`;
}

/** «Не вышло»: дубль называет день загрузки, нечитаемый чек — что сделать; прочее — общий отказ. */
export function failedReceiptText(t: TelegramT, card: ReceiptCard): string {
  const { receipt } = card;
  if (receipt.errorCode === "RECEIPT_DUPLICATE" && receipt.duplicateOf !== null) {
    return t("bot.receipt.duplicate", { date: receipt.duplicateOf.date });
  }
  if (receipt.errorCode === "RECEIPT_UNREADABLE") return t("bot.receipt.unreadable");
  return t("bot.receipt.failed");
}

/** Итоги разбора выписки: «Найдено 47 операций, 12 уже были загружены. Импортировать 35?» (STMT-04, считает код). */
export function statementPreviewText(t: TelegramT, summary: ImportSummary): string {
  if (summary.newCount === 0) return t("bot.statement.nothingNew", { count: summary.found });
  return t("bot.statement.preview", {
    count: summary.found,
    duplicates: summary.duplicates,
    fresh: summary.newCount,
  });
}
