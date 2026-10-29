// Карточка операции — боковая панель (design/screens/Operations.dc.html, состояние operation-panel; TXN-05, STMT-09):
// сумма, контрагент, все поля, исходное описание, источник категории («выбрана вами», «по справочнику», …), у валюты —
// курс НБРБ с ⓘ «Откуда курс?», история изменений. Категорию меняют здесь же (сразу, с «Отменить»); «Изменить» и
// «Удалить» делает страница: ей принадлежат окна, подтверждение и «Отменить».
import type { AccountListItem, Transaction, TransactionRevision } from "@kosht/contract";
import { formatDate, formatScaled, formatTime } from "@kosht/i18n";
import { DEFAULT_TIME_ZONE, LocalDate } from "@kosht/kernel";
import { Button } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAccountName } from "../../entities/account/index.ts";
import { CategoryPicker } from "../../entities/category/index.ts";
import { moneyKindOf } from "../../entities/transaction/index.ts";
import { orpc } from "../../lib/api.ts";
import { EmptyState, Money, SkeletonText, WhyButton } from "../../ui/index.ts";
import classes from "./OperationPanel.module.css";

export interface OperationPanelProps {
  readonly id: string;
  readonly accounts: readonly AccountListItem[];
  readonly onEdit: (transaction: Transaction) => void;
  readonly onDelete: (transaction: Transaction) => void;
  readonly onCategory: (
    transaction: Transaction,
    category: NonNullable<Transaction["category"]>,
  ) => void;
  readonly onWhyRate: (transaction: Transaction) => void;
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className={classes.row}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function historyText(
  t: ReturnType<typeof useTranslation<"operations">>["t"],
  entry: TransactionRevision,
): string {
  const channel = t(`history.channel.${entry.channel}`);
  const fields = entry.fields.map((field) => t(`history.field.${field}`)).join(", ");
  return t(`history.${entry.action}`, { channel, fields });
}

export function OperationPanel({
  id,
  accounts,
  onEdit,
  onDelete,
  onCategory,
  onWhyRate,
}: OperationPanelProps) {
  const { t } = useTranslation("operations");
  const nameOf = useAccountName();
  const card = useQuery(orpc.transactions.get.queryOptions({ input: { id } }));
  if (card.isPending) return <SkeletonText />;
  if (card.isError) {
    return (
      <EmptyState
        tone="error"
        icon={AlertTriangle}
        title={t("panel.loadError")}
        description=""
        headingLevel={3}
      />
    );
  }
  const { transaction, rate, history } = card.data;
  const account = accounts.find((item) => item.id === transaction.accountId);
  const kind = moneyKindOf(transaction.type);
  const foreign = transaction.amount.currency !== "BYN";
  const title = transaction.merchantName ?? t("table.noMerchant");
  const showDescription = transaction.description !== "" && transaction.description !== title;
  return (
    <div className={classes.panel}>
      <div className={classes.toolbar}>
        <Button
          variant="default"
          size="sm"
          leftSection={<Pencil size={16} aria-hidden />}
          onClick={() => onEdit(transaction)}
        >
          {t("panel.edit")}
        </Button>
        <Button
          variant="default"
          size="sm"
          color="red"
          leftSection={<Trash2 size={16} aria-hidden />}
          onClick={() => onDelete(transaction)}
        >
          {t("panel.delete")}
        </Button>
      </div>
      <p className={classes.kind}>{t(`typeOne.${transaction.type}`)}</p>
      <p className={classes.amount}>
        <Money value={transaction.amountInByn ?? transaction.amount} kind={kind} size="kpi" />
        {transaction.amountInByn !== null && foreign && (
          <WhyButton subject={t("panel.whyRate")} onClick={() => onWhyRate(transaction)} />
        )}
      </p>
      <h3 className={classes.merchant}>{title}</h3>
      <dl className={classes.fields}>
        <Row label={t("panel.dateTime")}>
          {formatDate(transaction.occurredOn)}
          {transaction.occurredTime !== null && `, ${formatTime(transaction.occurredTime)}`}
        </Row>
        <Row label={t("panel.account")}>{account === undefined ? "—" : nameOf(account)}</Row>
        <Row label={t("panel.type")}>{t(`typeOne.${transaction.type}`)}</Row>
        <Row label={t("panel.source")}>{t(`source.${transaction.source}`)}</Row>
        {showDescription && <Row label={t("panel.description")}>{transaction.description}</Row>}
        {transaction.note !== null && <Row label={t("panel.note")}>{transaction.note}</Row>}
        {foreign && (
          <Row label={t("panel.amountOriginal")}>
            <Money value={transaction.amount} tabular />
          </Row>
        )}
        {foreign && transaction.amountInByn !== null && (
          <Row label={t("panel.amountInByn")}>
            <Money value={transaction.amountInByn} tabular />
          </Row>
        )}
        {(transaction.transferPairId !== null || transaction.refundOfId !== null) && (
          <Row label={transaction.transferPairId !== null ? t("panel.pair") : t("panel.refundOf")}>
            {t("panel.linked")}
          </Row>
        )}
      </dl>
      {foreign && transaction.amountInByn === null && (
        <p className={classes.note}>{t("panel.noRate")}</p>
      )}
      {rate !== null && (
        <p className={classes.note}>
          {t("panel.rate", {
            date: formatDate(rate.date),
            rate: formatScaled(rate.rateE4, 4),
            scale: rate.scale,
          })}
        </p>
      )}
      {transaction.type !== "transfer" && (
        <div className={classes.category}>
          <CategoryPicker
            kind={transaction.type === "income" ? "income" : "expense"}
            value={transaction.category}
            label={t("panel.category")}
            onChange={(category) => onCategory(transaction, category)}
          />
          {transaction.categorySource !== null && (
            <CategorySource source={transaction.categorySource} />
          )}
        </div>
      )}
      <h4 className={classes.historyTitle}>{t("panel.history")}</h4>
      <ul className={classes.history}>
        {history.map((entry, index) => (
          <li key={`${entry.at}-${String(index)}`}>
            <span className={classes.when}>
              {formatDate(LocalDate.fromInstant(new Date(entry.at), DEFAULT_TIME_ZONE))}
            </span>{" "}
            {historyText(t, entry)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CategorySource({
  source,
}: {
  readonly source: NonNullable<Transaction["categorySource"]>;
}) {
  const { t } = useTranslation(["operations", "categories"]);
  return (
    <p className={classes.note}>
      {t("operations:panel.categorySource", { source: t(`categories:source.${source}`) })}
    </p>
  );
}
