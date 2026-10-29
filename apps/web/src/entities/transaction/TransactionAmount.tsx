// Сумма операции в строке и карточке (TXN-01, STMT-09, DES-07): в колонке «Сумма, BYN» — эквивалент в BYN (доход «+»
// зелёным, расход «−», перевод нейтрально); у валюты под ним — исходная сумма; курса НБРБ ещё нет — исходная сумма и
// отметка «курс не получен», а не ноль. Числа готовые (P1), здесь только показ.
import type { Transaction } from "@kosht/contract";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Money, StatusBadge, type MoneyKind } from "../../ui/index.ts";
import classes from "./TransactionAmount.module.css";

/** Смысл суммы для знака и цвета: доход и возврат — «+», расход — «−», перевод — нейтрально. */
export function moneyKindOf(type: Transaction["type"]): MoneyKind {
  if (type === "transfer") return "transfer";
  return type === "expense" ? "expense" : "income";
}

export function TransactionAmount({ transaction }: { readonly transaction: Transaction }) {
  const { t } = useTranslation("operations");
  const kind = moneyKindOf(transaction.type);
  const foreign = transaction.amount.currency !== "BYN";
  if (transaction.amountInByn === null) {
    return (
      <span className={classes.amount}>
        <Money value={transaction.amount} kind={kind} tabular />
        <StatusBadge tone="warn" icon={Clock}>
          {t("badge.noRate")}
        </StatusBadge>
      </span>
    );
  }
  return (
    <span className={classes.amount}>
      <Money value={transaction.amountInByn} kind={kind} tabular />
      {foreign && (
        <span className={classes.original}>
          <Money value={transaction.amount} tabular />
        </span>
      )}
    </span>
  );
}
