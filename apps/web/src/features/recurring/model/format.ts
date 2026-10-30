// Подписи и ссылки платежа для строк и карточек решений (REC-02): категория, период, «каждый месяц 9-го».
import {
  CategoryId,
  SystemCategoryCode,
  type CategoryRef,
  type RecurringItem,
  type RecurringSection,
} from "@kosht/contract";
import type { useTranslation } from "react-i18next";

export const SECTIONS: readonly RecurringSection[] = [
  "income",
  "mandatory",
  "subscriptions",
  "other",
];

export type T = ReturnType<typeof useTranslation<"recurring">>["t"];

export function categoryRef(item: RecurringItem): CategoryRef | null {
  if (item.categoryCode !== null) {
    const code = SystemCategoryCode.safeParse(item.categoryCode);
    if (code.success) return { type: "system", code: code.data };
  }
  if (item.categoryId !== null) {
    const id = CategoryId.safeParse(item.categoryId);
    if (id.success) return { type: "custom", id: id.data };
  }
  return null;
}

export function periodText(t: T, item: RecurringItem): string {
  const day = item.anchorDay ?? 0;
  return t(`period.${item.period}`, { day });
}

export function everyText(t: T, item: RecurringItem): string {
  const key = (
    {
      week: "everyWeek",
      month: "everyMonth",
      quarter: "everyQuarter",
      year: "everyYear",
    } as const
  )[item.period];
  return t(`period.${key}`, { day: item.anchorDay ?? 0 });
}
