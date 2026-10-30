// Форма операции (design/screens/Operations.dc.html, состояние add-operation; TXN-03): тип (расход, доход, перевод,
// возврат), сумма в валюте счёта, дата и время, счёт, категория с «Новая категория» (у перевода её нет), контрагент и
// комментарий. Добавление и правка — одна форма: правка отправляет только изменённые поля. Сумма — `parseMoney` в
// копейки без float (P1); схема входа — та же, что у сервера (CreateTransactionInput).
import {
  CreateTransactionInput,
  TransactionType,
  type AccountListItem,
  type CategoryRef,
  type Transaction,
  type UpdateTransactionPatch,
} from "@kosht/contract";
import { formatScaled, parseMoney } from "@kosht/i18n";
import { Button, SegmentedControl, Select, Stack, TextInput } from "@mantine/core";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { useAccountName } from "../../entities/account/index.ts";
import { CategoryPicker, refKey } from "../../entities/category/index.ts";
import classes from "./OperationForm.module.css";

export type FormResult =
  | { readonly kind: "create"; readonly input: z.input<typeof CreateTransactionInput> }
  | { readonly kind: "update"; readonly patch: UpdateTransactionPatch };

export interface OperationFormProps {
  readonly accounts: readonly AccountListItem[];
  /** Сегодня — по часам сервера (accounts.list.onDate): день по умолчанию. */
  readonly today: string;
  /** Правка существующей операции; нет — новая. */
  readonly transaction?: Transaction;
  readonly pending: boolean;
  readonly onSubmit: (result: FormResult) => void;
  readonly onCancel: () => void;
}

/** Сумма операции текстом для поля: «6,50» из копеек (знак не нужен — направление задаёт тип); форматтер — `@kosht/i18n`. */
const amountText = (minor: number): string => formatScaled(minor, 2);

/** Вид категорий для выбора: возврат покупки — расходные, доход — доходные. */
function pickerKind(type: Transaction["type"]): "expense" | "income" {
  return type === "income" ? "income" : "expense";
}

export function OperationForm({
  accounts,
  today,
  transaction,
  pending,
  onSubmit,
  onCancel,
}: OperationFormProps) {
  const { t } = useTranslation("operations");
  const nameOf = useAccountName();
  const cash = accounts.find((account) => account.kind === "cash") ?? accounts[0];
  const [type, setType] = useState<Transaction["type"]>(transaction?.type ?? "expense");
  const [direction, setDirection] = useState<"in" | "out">(transaction?.direction ?? "out");
  // Выбранный человеком счёт; пока он не выбирал, счёт — по умолчанию, и он появляется, как только пришёл список
  // счетов (форма может открыться раньше списка): состояние, взятое из пропса при монтировании, осталось бы пустым.
  const [chosenAccountId, setChosenAccountId] = useState<string | null>(null);
  const accountId = chosenAccountId ?? transaction?.accountId ?? cash?.id ?? "";
  const [amount, setAmount] = useState(
    transaction === undefined ? "" : amountText(transaction.amount.minor),
  );
  const [date, setDate] = useState<string>(transaction?.occurredOn ?? today);
  const [time, setTime] = useState(transaction?.occurredTime ?? "");
  const [category, setCategory] = useState<CategoryRef | null>(transaction?.category ?? null);
  const [merchant, setMerchant] = useState(transaction?.merchantName ?? "");
  const [note, setNote] = useState(transaction?.note ?? "");

  const account = accounts.find((item) => item.id === accountId);
  const currency = account?.balance.currency ?? "BYN";
  const money = amount.trim() === "" ? undefined : parseMoney(amount, currency);
  const amountValid = money !== undefined && money.minor > 0;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);

  const build = (): FormResult | undefined => {
    if (!amountValid || !dateValid || account === undefined) return undefined;
    const merchantValue = merchant.trim() === "" ? null : merchant.trim();
    const noteValue = note.trim() === "" ? null : note.trim();
    const timeValue = time === "" ? null : time;
    if (transaction === undefined) {
      const input = CreateTransactionInput.safeParse({
        accountId,
        type,
        ...(type === "transfer" ? { direction } : {}),
        occurredOn: date,
        occurredTime: timeValue,
        amount: money,
        merchant: merchantValue,
        note: noteValue,
        category: type === "transfer" ? null : category,
      });
      return input.success ? { kind: "create", input: input.data } : undefined;
    }
    const patch: Record<string, unknown> = {};
    if (accountId !== transaction.accountId) patch["accountId"] = accountId;
    if (type !== transaction.type) patch["type"] = type;
    if (type === "transfer" && direction !== transaction.direction) patch["direction"] = direction;
    if (date !== transaction.occurredOn) patch["occurredOn"] = date;
    if (timeValue !== transaction.occurredTime) patch["occurredTime"] = timeValue;
    if (
      money.minor !== transaction.amount.minor ||
      money.currency !== transaction.amount.currency
    ) {
      patch["amount"] = money;
    }
    if (merchantValue !== transaction.merchantName) patch["merchant"] = merchantValue;
    if (noteValue !== transaction.note) patch["note"] = noteValue;
    if (
      type !== "transfer" &&
      category !== null &&
      (transaction.category === null || refKey(category) !== refKey(transaction.category))
    ) {
      patch["category"] = category;
    }
    return Object.keys(patch).length === 0
      ? undefined
      : { kind: "update", patch: patch as UpdateTransactionPatch };
  };
  const result = build();
  const unchanged = transaction !== undefined && amountValid && dateValid && result === undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (result !== undefined) onSubmit(result);
  };

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <div>
          <p className={classes.label} id="operation-type">
            {t("form.type")}
          </p>
          <SegmentedControl
            aria-labelledby="operation-type"
            fullWidth
            value={type}
            onChange={(value) => {
              setType(TransactionType.parse(value));
              setCategory(null);
            }}
            data={TransactionType.options.map((value) => ({
              value,
              label: t(`typeOne.${value}`),
            }))}
            className={classes.types}
          />
        </div>
        <div className={classes.pair}>
          <TextInput
            label={t("form.amount", { currency })}
            placeholder={t("form.amountPlaceholder")}
            inputMode="decimal"
            value={amount}
            data-autofocus
            error={amount.trim() !== "" && !amountValid ? t("form.amountInvalid") : null}
            onChange={(event) => setAmount(event.currentTarget.value)}
          />
          <TextInput
            type="date"
            label={t("form.date")}
            value={date}
            error={dateValid ? null : t("form.dateInvalid")}
            onChange={(event) => setDate(event.currentTarget.value)}
          />
        </div>
        <div className={classes.pair}>
          <Select
            label={t("form.account")}
            data={accounts.map((item) => ({ value: item.id, label: nameOf(item) }))}
            value={accountId}
            allowDeselect={false}
            onChange={(value) => setChosenAccountId(value ?? accountId)}
          />
          <TextInput
            type="time"
            label={t("form.time")}
            description={t("form.timeHint")}
            value={time}
            onChange={(event) => setTime(event.currentTarget.value)}
          />
        </div>
        {type === "transfer" ? (
          <div>
            <p className={classes.label} id="operation-direction">
              {t("form.direction")}
            </p>
            <SegmentedControl
              aria-labelledby="operation-direction"
              fullWidth
              value={direction}
              onChange={(value) => setDirection(value === "in" ? "in" : "out")}
              data={[
                { value: "out", label: t("form.directionOut") },
                { value: "in", label: t("form.directionIn") },
              ]}
            />
          </div>
        ) : (
          <div>
            <CategoryPicker
              kind={pickerKind(type)}
              value={category}
              label={t("form.category")}
              onChange={setCategory}
            />
            {category === null && <p className={classes.hint}>{t("form.categoryAuto")}</p>}
          </div>
        )}
        <TextInput
          label={t("form.merchant")}
          placeholder={t("form.merchantPlaceholder")}
          value={merchant}
          maxLength={120}
          onChange={(event) => setMerchant(event.currentTarget.value)}
        />
        <TextInput
          label={
            <>
              {t("form.note")} <span className={classes.optional}>— {t("form.optional")}</span>
            </>
          }
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.currentTarget.value)}
        />
        {transaction === undefined && <p className={classes.hint}>{t("form.hint")}</p>}
        {unchanged && <p className={classes.hint}>{t("form.nothingChanged")}</p>}
        <div className={classes.actions}>
          <Button variant="subtle" onClick={onCancel}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" disabled={result === undefined} loading={pending}>
            {t("form.save")}
          </Button>
        </div>
      </Stack>
    </form>
  );
}
