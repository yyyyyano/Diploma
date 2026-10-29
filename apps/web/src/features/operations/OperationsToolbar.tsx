// Поиск и фильтры (design/screens/Operations.dc.html, TXN-02): текст — живой поиск (адрес обновляется через паузу),
// тип сегментами, категория, счёт, источник, период и границы суммы в BYN. Всё — в адресе (`OperationsSearch`);
// изменение фильтра сбрасывает страницу.
import { TransactionType, type AccountListItem } from "@kosht/contract";
import { Button, SegmentedControl, Select, TextInput } from "@mantine/core";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccountName } from "../../entities/account/index.ts";
import { refKey, useCategoryLookup } from "../../entities/category/index.ts";
import { amountMinor, hasFilters, OperationsSearch } from "./model/search.ts";
import classes from "./OperationsToolbar.module.css";

const SOURCES = ["manual", "assistant", "statement", "receipt"] as const;
const SEARCH_PAUSE_MS = 300;

export interface OperationsToolbarProps {
  readonly search: OperationsSearch;
  readonly accounts: readonly AccountListItem[];
  /** Новые значения фильтров (страница сбрасывается): `replace` — без записи в историю (набор текста). */
  readonly onChange: (patch: Partial<OperationsSearch>, replace?: boolean) => void;
  readonly onReset: () => void;
}

export function OperationsToolbar({ search, accounts, onChange, onReset }: OperationsToolbarProps) {
  const { t } = useTranslation("operations");
  const { t: tCategories } = useTranslation("categories");
  const nameOf = useAccountName();
  const categories = useCategoryLookup();
  const [text, setText] = useState(search.q ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Набранное уходит в адрес через паузу; адрес изменили снаружи («Сбросить фильтры», «назад») — поле следует за ним.
  const typeText = (value: string) => {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onChange({ q: value.trim() === "" ? undefined : value.trim(), page: undefined }, true);
    }, SEARCH_PAUSE_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  // Адрес изменили снаружи — поле следует за ним (разбор при отрисовке, а не в эффекте: без лишнего прохода).
  const [seenQ, setSeenQ] = useState(search.q);
  if (seenQ !== search.q) {
    setSeenQ(search.q);
    if ((search.q ?? "") !== text.trim()) setText(search.q ?? "");
  }

  const set = (patch: Partial<OperationsSearch>) => onChange({ ...patch, page: undefined });
  const amountInvalid = (value: string | undefined) =>
    value !== undefined && value.trim() !== "" && amountMinor(value) === undefined
      ? t("filters.amountInvalid")
      : null;

  return (
    <section className={classes.toolbar} aria-label={t("filtersLabel")}>
      <div className={classes.top}>
        <TextInput
          className={classes.search}
          aria-label={t("search.label")}
          placeholder={t("search.placeholder")}
          leftSection={<Search size={18} aria-hidden />}
          value={text}
          maxLength={100}
          onChange={(event) => typeText(event.currentTarget.value)}
        />
        <SegmentedControl
          aria-label={t("type.label")}
          value={search.type ?? "all"}
          onChange={(value) =>
            set({ type: value === "all" ? undefined : TransactionType.parse(value) })
          }
          data={[
            { value: "all", label: t("type.all") },
            { value: "expense", label: t("type.expense") },
            { value: "income", label: t("type.income") },
            { value: "transfer", label: t("type.transfer") },
            { value: "refund", label: t("type.refund") },
          ]}
          className={classes.types}
        />
      </div>
      <div className={classes.filters}>
        <Select
          aria-label={t("filters.categoryLabel")}
          placeholder={t("filters.category")}
          clearable
          searchable
          data={categories.items
            .filter((item) => !item.hidden || refKey(item.ref) === search.category)
            .map((item) => ({ value: refKey(item.ref), label: categories.nameOf(item.ref) }))}
          value={search.category ?? null}
          nothingFoundMessage={tCategories("picker.nothing")}
          onChange={(value) => set({ category: value ?? undefined })}
        />
        <Select
          aria-label={t("filters.accountLabel")}
          placeholder={t("filters.account")}
          clearable
          data={accounts.map((account) => ({ value: account.id, label: nameOf(account) }))}
          value={search.account ?? null}
          onChange={(value) =>
            set({ account: OperationsSearch.shape.account.parse(value ?? undefined) })
          }
        />
        <Select
          aria-label={t("filters.sourceLabel")}
          placeholder={t("filters.source")}
          clearable
          data={SOURCES.map((value) => ({ value, label: t(`source.${value}`) }))}
          value={search.source ?? null}
          onChange={(value) => set({ source: SOURCES.find((source) => source === value) })}
        />
      </div>
      <div className={classes.filters}>
        <TextInput
          type="date"
          label={t("filters.from")}
          value={search.from ?? ""}
          onChange={(event) =>
            set({ from: OperationsSearch.shape.from.parse(event.currentTarget.value || undefined) })
          }
        />
        <TextInput
          type="date"
          label={t("filters.to")}
          value={search.to ?? ""}
          onChange={(event) =>
            set({ to: OperationsSearch.shape.to.parse(event.currentTarget.value || undefined) })
          }
        />
        <TextInput
          label={t("filters.amountFrom")}
          inputMode="decimal"
          value={search.min ?? ""}
          error={amountInvalid(search.min)}
          onChange={(event) => set({ min: event.currentTarget.value || undefined })}
        />
        <TextInput
          label={t("filters.amountTo")}
          inputMode="decimal"
          value={search.max ?? ""}
          error={amountInvalid(search.max)}
          onChange={(event) => set({ max: event.currentTarget.value || undefined })}
        />
      </div>
      {hasFilters(search) && (
        <Button variant="subtle" size="sm" className={classes.reset} onClick={onReset}>
          {t("filters.reset")}
        </Button>
      )}
    </section>
  );
}
