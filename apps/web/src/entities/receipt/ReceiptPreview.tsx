// Чек в чате (CHAT-03, CHAT-04, design/screens/Assistant.dc.html «карточка чека»): магазин, день, первые позиции, итог и
// статус проверки. Числа — готовые с сервера (P1). Кнопки («Открыть чек») подставляет вызывающий (children).
import type { ReceiptCard } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import { Receipt } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Money } from "../../ui/index.ts";
import classes from "./ReceiptPreview.module.css";
import { ReceiptStatusBadge } from "./ReceiptStatus.tsx";

/** Сколько позиций показывает карточка чата; остальные — «и ещё N» (полный список — в «Чеках и документах»). */
const SHOWN_ITEMS = 4;

export interface ReceiptPreviewProps {
  readonly card: ReceiptCard;
  readonly children?: ReactNode;
}

export function ReceiptPreview({ card, children }: ReceiptPreviewProps) {
  const { t } = useTranslation("documents");
  const titleId = useId();
  const { receipt, items } = card;
  const shown = items.slice(0, SHOWN_ITEMS);
  const more = items.length - shown.length;
  return (
    <article className={classes.card} aria-labelledby={titleId}>
      <div className={classes.head}>
        <span className={classes.icon} aria-hidden>
          <Receipt size={18} strokeWidth={1.8} />
        </span>
        <div className={classes.text}>
          <h4 className={classes.title} id={titleId}>
            {receipt.storeName ?? t("receipts.list.store")}
          </h4>
          {receipt.purchaseDate !== null && (
            <div className={classes.sub}>{formatDate(receipt.purchaseDate)}</div>
          )}
        </div>
        <ReceiptStatusBadge receipt={receipt} />
      </div>
      {shown.length > 0 && (
        <ul className={classes.items}>
          {shown.map((item) => (
            <li key={item.position} className={classes.item}>
              <span className={classes.name}>{item.name}</span>
              {item.lineTotal !== null && <Money value={item.lineTotal} tabular />}
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className={classes.more}>{t("receipts.card.more", { count: more })}</p>}
      {receipt.total !== null && (
        <div className={classes.total}>
          <span>{t("receipts.editor.total")}</span>
          <Money value={receipt.total} tabular />
        </div>
      )}
      {children !== undefined && <div className={classes.actions}>{children}</div>}
    </article>
  );
}
