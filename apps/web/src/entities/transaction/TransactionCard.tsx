// Карточка операции в чате (CHAT-04, AGT-05, design/screens/Assistant.dc.html «Записал операцию»): категория словами,
// день и контрагент, сумма. «Отменить / Изменить» подставляет вызывающий (children). Сумму показывает `TransactionAmount`
// готовой с сервера (P1); название категории приходит из результата инструмента, а не придумывается здесь.
import type { Transaction } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import { ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";
import classes from "./TransactionCard.module.css";
import { TransactionAmount } from "./TransactionAmount.tsx";

export interface TransactionCardProps {
  readonly transaction: Transaction;
  /** Название категории словами; у перевода и операции без категории — null. */
  readonly categoryName: string | null;
  /** Что случилось: «Записал операцию», «Изменил операцию». */
  readonly heading: string;
  /** Кнопки под карточкой. */
  readonly children?: ReactNode;
}

export function TransactionCard({
  transaction,
  categoryName,
  heading,
  children,
}: TransactionCardProps) {
  const titleId = useId();
  const title = categoryName ?? transaction.merchantName ?? transaction.description;
  const subtitle = [formatDate(transaction.occurredOn), transaction.merchantName]
    .filter((part): part is string => part !== null && part !== title)
    .join(" · ");
  return (
    <article className={classes.card} aria-labelledby={titleId}>
      <div className={classes.row}>
        <span className={classes.icon} aria-hidden>
          <ReceiptText size={18} strokeWidth={1.8} />
        </span>
        <div className={classes.text}>
          <div className={classes.heading}>{heading}</div>
          <h4 className={classes.title} id={titleId}>
            {title}
          </h4>
          <div className={classes.sub}>{subtitle}</div>
        </div>
        <TransactionAmount transaction={transaction} />
      </div>
      {children !== undefined && <div className={classes.actions}>{children}</div>}
    </article>
  );
}
