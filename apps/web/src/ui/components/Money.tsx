// Сумма (DES-17, DES-07, design/DESIGN.md §6): «1 234,56 BYN» — неразрывные пробелы, код валюты мельче и светлее.
// Знак и цвет — по смыслу: доход «+» зелёным, расход «−» основным цветом, перевод — нейтрально со значком ⇄.
// Сумма приходит готовой с сервера (P1): компонент только показывает её, ничего не считая.
import { formatMoneyParts } from "@kosht/i18n";
import type { Money as MoneyValue } from "@kosht/kernel";
import { VisuallyHidden } from "@mantine/core";
import { ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cx } from "../cx.ts";
import classes from "./Money.module.css";

export type MoneyKind = "income" | "expense" | "transfer";

export interface MoneyProps {
  readonly value: MoneyValue;
  /** Смысл суммы: доход, расход или перевод; без него знак — как у числа. */
  readonly kind?: MoneyKind;
  /** Табличные цифры — в таблицах и колонках, чтобы суммы стояли ровно (DES-07). */
  readonly tabular?: boolean;
  /** kpi — крупное число карточки показателя. */
  readonly size?: "md" | "kpi";
}

const PLUS = "+";
const MINUS = String.fromCharCode(0x2212);
const NBSP = String.fromCharCode(0x00a0);

function signOf(kind: MoneyKind | undefined, negative: boolean, zero: boolean): string {
  if (zero || kind === "transfer") return "";
  if (kind === "income") return PLUS;
  if (kind === "expense") return MINUS;
  return negative ? MINUS : "";
}

export function Money({ value, kind, tabular = false, size = "md" }: MoneyProps) {
  const { t } = useTranslation("ui");
  const { negative, amount, currency } = formatMoneyParts(value);
  const sign = signOf(kind, negative, value.minor === 0);
  return (
    <span
      className={cx(
        classes.money,
        kind !== undefined && classes[kind],
        tabular && classes.tabular,
        size === "kpi" && classes.kpi,
      )}
    >
      {kind === "transfer" && (
        <>
          <ArrowLeftRight className={classes.icon} size={14} strokeWidth={1.8} aria-hidden />
          <VisuallyHidden>{t("money.transfer")}</VisuallyHidden>
        </>
      )}
      {sign}
      {amount}
      <span className={classes.currency}>
        {NBSP}
        {currency}
      </span>
    </span>
  );
}
