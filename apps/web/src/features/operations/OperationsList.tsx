// Список операций (design/screens/Operations.dc.html, TXN-01, TXN-02): на компьютере — таблица со страницами по 50 и
// счётчиком «Показано N из M», на телефоне (390 px) — карточки и «Показать ещё», без горизонтальной прокрутки.
// Строка открывает карточку операции (кнопка в ячейке контрагента — для клавиатуры, вся строка — для мышки).
// Показывает уже загруженное: запросы — у страницы.
import type { AccountListItem, Transaction } from "@kosht/contract";
import { formatDate, formatTime } from "@kosht/i18n";
import { Button, Pagination } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useAccountName } from "../../entities/account/index.ts";
import { CategoryBadge } from "../../entities/category/index.ts";
import { TransactionAmount } from "../../entities/transaction/index.ts";
import { StatusBadge } from "../../ui/index.ts";
import { ArrowLeftRight, Undo2 } from "lucide-react";
import classes from "./OperationsList.module.css";

export interface OperationsListProps {
  readonly items: readonly Transaction[];
  readonly total: number;
  readonly accounts: readonly AccountListItem[];
  readonly onOpen: (id: string) => void;
}

function useRowParts(accounts: readonly AccountListItem[]) {
  const { t } = useTranslation("operations");
  const nameOf = useAccountName();
  return {
    title: (item: Transaction) => item.merchantName ?? t("table.noMerchant"),
    account: (item: Transaction) => {
      const found = accounts.find((account) => account.id === item.accountId);
      return found === undefined ? "—" : nameOf(found);
    },
    when: (item: Transaction) =>
      item.occurredTime === null
        ? formatDate(item.occurredOn)
        : `${formatDate(item.occurredOn)} ${formatTime(item.occurredTime)}`,
    /** Исходное описание показывается мелко под названием, если оно отличается от него. */
    description: (item: Transaction) =>
      item.description !== "" && item.description !== item.merchantName ? item.description : null,
  };
}

function Badges({ item }: { readonly item: Transaction }) {
  const { t } = useTranslation("operations");
  if (item.type === "transfer") {
    return (
      <StatusBadge tone="neutral" icon={ArrowLeftRight}>
        {t("badge.transfer")}
      </StatusBadge>
    );
  }
  return (
    <span className={classes.category}>
      <CategoryBadge category={item.category} />
      {item.type === "refund" && (
        <StatusBadge tone="ok" icon={Undo2}>
          {t("badge.refund")}
        </StatusBadge>
      )}
    </span>
  );
}

export function OperationsTable({
  items,
  total,
  accounts,
  page,
  pageSize,
  onPage,
  onOpen,
}: OperationsListProps & {
  readonly page: number;
  readonly pageSize: number;
  readonly onPage: (page: number) => void;
}) {
  const { t } = useTranslation("operations");
  const parts = useRowParts(accounts);
  return (
    <div className={classes.card}>
      <table className={classes.table} aria-label={t("table.label")}>
        <thead>
          <tr>
            <th scope="col">{t("table.date")}</th>
            <th scope="col">{t("table.merchant")}</th>
            <th scope="col">{t("table.category")}</th>
            <th scope="col">{t("table.account")}</th>
            <th scope="col" className={classes.right}>
              {t("table.amount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className={classes.row} onClick={() => onOpen(item.id)}>
              <td className={classes.date}>{parts.when(item)}</td>
              <td className={classes.merchant}>
                <button
                  type="button"
                  className={classes.open}
                  aria-label={t("table.open", { name: parts.title(item) })}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(item.id);
                  }}
                >
                  {parts.title(item)}
                </button>
                {parts.description(item) !== null && (
                  <span className={classes.description}>{parts.description(item)}</span>
                )}
              </td>
              <td>
                <Badges item={item} />
              </td>
              <td>{parts.account(item)}</td>
              <td className={classes.right}>
                <TransactionAmount transaction={item} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={classes.footer}>
        <span>{t("pagination.shown", { shown: items.length, total })}</span>
        {total > pageSize && (
          <Pagination
            value={page}
            total={Math.ceil(total / pageSize)}
            onChange={onPage}
            aria-label={t("pagination.label")}
            getItemProps={(index) => ({ "aria-label": t("pagination.page", { page: index }) })}
            getControlProps={(control) => ({
              "aria-label":
                control === "next"
                  ? t("pagination.next")
                  : control === "previous"
                    ? t("pagination.prev")
                    : control,
            })}
          />
        )}
      </div>
    </div>
  );
}

export function OperationsCards({
  items,
  total,
  accounts,
  hasMore,
  loadingMore,
  onMore,
  onOpen,
}: OperationsListProps & {
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onMore: () => void;
}) {
  const { t } = useTranslation("operations");
  const parts = useRowParts(accounts);
  return (
    <div className={classes.card}>
      <ul className={classes.cards} aria-label={t("table.label")}>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={classes.cardButton}
              aria-label={t("table.open", { name: parts.title(item) })}
              onClick={() => onOpen(item.id)}
            >
              <span className={classes.cardTop}>
                <span className={classes.cardTitle}>{parts.title(item)}</span>
                <TransactionAmount transaction={item} />
              </span>
              <span className={classes.cardMeta}>
                {parts.when(item)} · {parts.account(item)}
              </span>
              {parts.description(item) !== null && (
                <span className={classes.description}>{parts.description(item)}</span>
              )}
              <Badges item={item} />
            </button>
          </li>
        ))}
      </ul>
      <div className={classes.footer}>
        <span>{t("pagination.shown", { shown: items.length, total })}</span>
        {hasMore && (
          <Button variant="default" loading={loadingMore} onClick={onMore}>
            {t("pagination.more")}
          </Button>
        )}
      </div>
    </div>
  );
}
