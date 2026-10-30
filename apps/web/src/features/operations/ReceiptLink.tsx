// Чек в карточке операции (TXN-10, TXN-11, RCPT-11, design/screens/Operations.dc.html): ссылка на чек, пометка «ожидает
// выписки» / «одна операция из выписки и чека», ручная связь с чеком и разрыв — с «Отменить». Суммы здесь не считаются.
import type { ReceiptSummary, Transaction } from "@kosht/contract";
import { formatDate, formatMoney } from "@kosht/i18n";
import { Button, Select } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Receipt } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UndoActionToast } from "../../entities/action/index.ts";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import classes from "./OperationPanel.module.css";

export function ReceiptLink({ transaction }: { readonly transaction: Transaction }) {
  const { t } = useTranslation(["operations", "errors"]);
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ token: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const linkable =
    transaction.receiptId === null &&
    transaction.source === "statement" &&
    transaction.type === "expense";
  const receipts = useQuery({ ...orpc.receipts.list.queryOptions(), enabled: linkable });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.transactions.key() });
    await queryClient.invalidateQueries({ queryKey: orpc.receipts.key() });
    await queryClient.invalidateQueries({ queryKey: orpc.accounts.key() });
  };
  const failed = (cause: unknown) =>
    setError(
      t("operations:panel.receipt.error", {
        reason: t(`errors:${errorCodeOf(cause)}`, errorParamsOf(cause)),
      }),
    );
  const unlink = useMutation(
    orpc.transactions.unlinkReceipt.mutationOptions({
      onSuccess: async (result) => {
        setError(null);
        setToast({ token: result.undoToken, message: t("operations:panel.receipt.unlinked") });
        await refresh();
      },
      onError: failed,
    }),
  );
  const link = useMutation(
    orpc.transactions.linkReceipt.mutationOptions({
      onSuccess: async (result) => {
        setError(null);
        setPicked(null);
        setToast({ token: result.undoToken, message: t("operations:panel.receipt.linked") });
        await refresh();
      },
      onError: failed,
    }),
  );
  const merged = transaction.receiptId !== null && transaction.source !== "receipt";

  return (
    <div className={classes.statement}>
      {transaction.receiptId !== null && (
        <>
          <Link
            to="/documents"
            search={{ open: transaction.receiptId }}
            className={classes.statementCard}
          >
            <Receipt size={18} aria-hidden className={classes.statementIcon} />
            <span className={classes.statementText}>
              <span className={classes.statementLabel}>{t("operations:panel.receipt.label")}</span>
              <span className={classes.statementName}>
                {transaction.pending
                  ? t("operations:panel.receipt.pending")
                  : merged
                    ? t("operations:panel.receipt.merged")
                    : t("operations:panel.receipt.open")}
              </span>
            </span>
            <ChevronRight size={16} aria-hidden />
          </Link>
          {merged && (
            <Button
              size="xs"
              variant="default"
              loading={unlink.isPending}
              onClick={() => unlink.mutate({ id: transaction.id })}
            >
              {t("operations:panel.receipt.unlink")}
            </Button>
          )}
        </>
      )}
      {linkable && receipts.data !== undefined && (
        <ReceiptPicker
          items={receipts.data.items}
          value={picked}
          onChange={setPicked}
          pending={link.isPending}
          onLink={() => picked !== null && link.mutate({ id: transaction.id, receiptId: picked })}
        />
      )}
      {error !== null && (
        <p className={classes.fileLink} role="alert">
          {error}
        </p>
      )}
      {toast !== null && (
        <UndoActionToast
          opened
          token={toast.token}
          message={toast.message}
          onClose={() => setToast(null)}
          onResult={(result) => {
            setToast(null);
            if (result.ok) void refresh();
            else failed(result.error);
          }}
        />
      )}
    </div>
  );
}

function ReceiptPicker({
  items,
  value,
  onChange,
  pending,
  onLink,
}: {
  readonly items: readonly ReceiptSummary[];
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly pending: boolean;
  readonly onLink: () => void;
}) {
  const { t } = useTranslation("operations");
  const choices = items.filter((item) => item.status === "ok" || item.status === "needs-review");
  if (choices.length === 0)
    return <p className={classes.fileLink}>{t("panel.receipt.noReceipts")}</p>;
  return (
    <div>
      <Select
        label={t("panel.receipt.linkPick")}
        placeholder={t("panel.receipt.linkPlaceholder")}
        data={choices.map((item) => ({
          value: item.id,
          label: [
            item.storeName ?? "—",
            item.purchaseDate === null ? null : formatDate(item.purchaseDate),
            item.total === null ? null : formatMoney(item.total),
          ]
            .filter((part) => part !== null)
            .join(" · "),
        }))}
        value={value}
        onChange={onChange}
      />
      <Button size="xs" mt="xs" disabled={value === null} loading={pending} onClick={onLink}>
        {t("panel.receipt.linkConfirm")}
      </Button>
    </div>
  );
}
