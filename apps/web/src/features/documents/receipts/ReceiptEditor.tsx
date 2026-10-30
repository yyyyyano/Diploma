// Редактор позиций чека — «Изменить» (RCPT-08, design/screens/Documents.dc.html): числа по фото правит человек, а сумму
// строки, итог, статус и остаток пересчитывает сервер тем же валидатором, что и распознавание (P1). Здесь — только ввод:
// текст «2,49» и «0,345» разбирается в копейки и тысячные (parseMoney, parseQuantity), без арифметики.
import type { ReceiptCard } from "@kosht/contract";
import { parseMoney } from "@kosht/i18n";
import { Button, Modal, TextInput } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatQuantity, parseQuantity, plainAmount } from "../../../entities/receipt/index.ts";
import { orpc } from "../../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../../lib/errors.ts";
import classes from "./ReceiptsSection.module.css";

interface Row {
  name: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  lineTotal: string;
}

export function ReceiptEditor({
  card,
  onClose,
  onSaved,
}: {
  readonly card: ReceiptCard;
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation(["documents", "errors"]);
  const currency = card.receipt.total?.currency ?? "BYN";
  const [rows, setRows] = useState<Row[]>(
    card.items.map((item) => ({
      name: item.name,
      quantity: item.quantityMilli === null ? "" : formatQuantity(item.quantityMilli),
      unitPrice: item.unitPrice === null ? "" : plainAmount(item.unitPrice),
      discount: plainAmount(item.discount),
      lineTotal: item.lineTotal === null ? "" : plainAmount(item.lineTotal),
    })),
  );
  const [total, setTotal] = useState(
    card.receipt.total === null ? "" : plainAmount(card.receipt.total),
  );
  const [receiptDiscount, setReceiptDiscount] = useState(plainAmount(card.receiptDiscount));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation(
    orpc.receipts.updateItems.mutationOptions({
      onSuccess: onSaved,
      onError: (cause) =>
        setError(
          t("documents:receipts.card.error", {
            reason: t(`errors:${errorCodeOf(cause)}`, errorParamsOf(cause)),
          }),
        ),
    }),
  );

  const patch = (index: number, value: Partial<Row>) =>
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...value } : row)));

  const submit = () => {
    const items = rows.map((row) => ({
      name: row.name,
      quantityMilli: parseQuantity(row.quantity),
      unitPrice: parseMoney(row.unitPrice, currency),
      discount: parseMoney(row.discount === "" ? "0" : row.discount, currency),
      lineTotal: parseMoney(row.lineTotal, currency),
    }));
    const totalMoney = parseMoney(total, currency);
    const discountMoney = parseMoney(receiptDiscount === "" ? "0" : receiptDiscount, currency);
    const valid = items.every(
      (item) =>
        item.name.trim() !== "" &&
        item.quantityMilli !== undefined &&
        item.unitPrice !== undefined &&
        item.discount !== undefined &&
        item.lineTotal !== undefined,
    );
    if (!valid || totalMoney === undefined || discountMoney === undefined) {
      setError(t("documents:receipts.editor.invalid"));
      return;
    }
    setError(null);
    save.mutate({
      id: card.receipt.id,
      items: items.flatMap((item) =>
        item.quantityMilli === undefined ||
        item.unitPrice === undefined ||
        item.discount === undefined ||
        item.lineTotal === undefined
          ? []
          : [
              {
                name: item.name,
                quantityMilli: item.quantityMilli,
                unitPrice: item.unitPrice,
                discount: item.discount,
                lineTotal: item.lineTotal,
              },
            ],
      ),
      total: totalMoney,
      receiptDiscount: discountMoney,
    });
  };

  return (
    <Modal opened onClose={onClose} title={t("documents:receipts.editor.title")} size="xl" centered>
      <p className={classes.hint}>{t("documents:receipts.editor.text")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <ol className={classes.lines} aria-label={t("documents:receipts.editor.title")}>
          {rows.map((row, index) => (
            <li key={index} className={classes.line} style={{ display: "block" }}>
              <div className={classes.editorRow}>
                <TextInput
                  label={`${t("documents:receipts.editor.line", { n: index + 1 })}: ${t("documents:receipts.editor.name")}`}
                  value={row.name}
                  onChange={(event) => patch(index, { name: event.currentTarget.value })}
                />
                <TextInput
                  label={t("documents:receipts.editor.quantity")}
                  inputMode="decimal"
                  value={row.quantity}
                  onChange={(event) => patch(index, { quantity: event.currentTarget.value })}
                />
                <TextInput
                  label={t("documents:receipts.editor.price")}
                  inputMode="decimal"
                  value={row.unitPrice}
                  onChange={(event) => patch(index, { unitPrice: event.currentTarget.value })}
                />
                <TextInput
                  label={t("documents:receipts.editor.discount")}
                  inputMode="decimal"
                  value={row.discount}
                  onChange={(event) => patch(index, { discount: event.currentTarget.value })}
                />
                <TextInput
                  label={t("documents:receipts.editor.lineTotal")}
                  inputMode="decimal"
                  value={row.lineTotal}
                  onChange={(event) => patch(index, { lineTotal: event.currentTarget.value })}
                />
              </div>
            </li>
          ))}
        </ol>
        <div className={classes.editorRow} style={{ marginTop: "var(--s-12)" }}>
          <TextInput
            label={t("documents:receipts.editor.total")}
            inputMode="decimal"
            value={total}
            onChange={(event) => setTotal(event.currentTarget.value)}
          />
          <TextInput
            label={t("documents:receipts.editor.receiptDiscount")}
            inputMode="decimal"
            value={receiptDiscount}
            onChange={(event) => setReceiptDiscount(event.currentTarget.value)}
          />
        </div>
        {error !== null && (
          <p className={classes.error} role="alert">
            {error}
          </p>
        )}
        <div className={classes.actions} style={{ marginTop: "var(--s-16)" }}>
          <Button type="submit" loading={save.isPending}>
            {t("documents:receipts.editor.save")}
          </Button>
          <Button variant="default" onClick={onClose}>
            {t("documents:receipts.editor.cancel")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
