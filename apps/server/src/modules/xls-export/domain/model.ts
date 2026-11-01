// Модель выгрузки (XLS-02): строки листа «Операции» и лимиты месяца — то, что приходит от соседей, уже в виде, готовом к книге
// (названия счетов и категорий подставлены, у операции — сумма в BYN или `null`, если курса нет).
import type { TransactionType } from "@kosht/contract";
import type { Money } from "@kosht/kernel";

export interface ExportRow {
  /** День операции «ГГГГ-ММ-ДД». */
  readonly date: string;
  readonly account: string;
  readonly type: TransactionType;
  readonly counterparty: string;
  /** Название категории; у перевода — пусто. */
  readonly category: string;
  /** Сумма в валюте операции, положительная: знак — по типу. */
  readonly amount: Money;
  /** Эквивалент в BYN по курсу НБРБ на день операции; курса нет — `null` (ячейка пустая, в итоги не входит). */
  readonly amountByn: Money | null;
}

export interface ExportLimit {
  readonly category: string;
  readonly limit: Money;
}

export interface ExportInput {
  /** Границы выгрузки, обе входят. */
  readonly from: string;
  readonly to: string;
  readonly rows: readonly ExportRow[];
  /** Лимиты месяца конца периода (BUD-01): месяц «ГГГГ-ММ» и лимиты по категориям. */
  readonly limitMonth: string;
  readonly limits: readonly ExportLimit[];
}
