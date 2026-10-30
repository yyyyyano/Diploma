// Окно «Новый лимит» / правка лимита (BUD-01, BUD-06): расходная категория, сумма на месяц, пороги уведомлений.
// Вход проверяет схема контракта — та же, что на сервере; у категории один лимит, повторное сохранение меняет сумму.
import { SetLimitInput, type BudgetLimit } from "@kosht/contract";
import { formatMoneyParts, parseMoney } from "@kosht/i18n";
import { Button, Checkbox, Select, Stack, TextInput } from "@mantine/core";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { categoryName, refKey, useCategoryLookup } from "../../entities/category/index.ts";
import classes from "./BudgetPage.module.css";

export function LimitForm({
  limit,
  pending,
  onSubmit,
  onCancel,
}: {
  /** Правка существующего лимита; без него — новый. */
  readonly limit?: BudgetLimit;
  readonly pending: boolean;
  readonly onSubmit: (input: ReturnType<typeof SetLimitInput.parse>) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation("budget");
  const { t: tCategories } = useTranslation("categories");
  const lookup = useCategoryLookup();
  const [category, setCategory] = useState<string | null>(limit?.categoryKey ?? null);
  const [amount, setAmount] = useState(
    limit === undefined ? "" : formatMoneyParts(limit.limit).amount,
  );
  const [notify80, setNotify80] = useState(limit?.notify80 ?? true);
  const [notify100, setNotify100] = useState(limit?.notify100 ?? true);
  const parsed = parseMoney(amount, "BYN");
  const input = SetLimitInput.safeParse({
    ...(category === null ? {} : { categoryKey: category }),
    ...(parsed === undefined ? {} : { limit: parsed }),
    notify80,
    notify100,
  });
  const valid = input.success && parsed !== undefined && parsed.minor > 0;
  const options = lookup.items
    .filter((item) => item.kind === "expense" && (!item.hidden || refKey(item.ref) === category))
    .map((item) => ({ value: refKey(item.ref), label: categoryName(tCategories, item) }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (input.success && valid) onSubmit(input.data);
  };
  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <Select
          label={t("limitForm.category")}
          placeholder={t("limitForm.categoryPlaceholder")}
          searchable
          allowDeselect={false}
          disabled={limit !== undefined}
          value={category}
          onChange={setCategory}
          data={options}
        />
        <TextInput
          label={t("limitForm.amount")}
          inputMode="decimal"
          value={amount}
          error={!valid && amount !== "" ? t("limitForm.amountInvalid") : null}
          onChange={(event) => setAmount(event.currentTarget.value)}
        />
        <fieldset className={classes.fieldset}>
          <legend className={classes.legend}>{t("limitForm.notify")}</legend>
          <Checkbox
            label={t("limits.notify80")}
            checked={notify80}
            onChange={(e) => setNotify80(e.currentTarget.checked)}
          />
          <Checkbox
            label={t("limits.notify100")}
            checked={notify100}
            onChange={(e) => setNotify100(e.currentTarget.checked)}
          />
        </fieldset>
        <p className={classes.muted}>{t("limitForm.hint")}</p>
        <div className={classes.buttons}>
          <Button type="submit" disabled={!valid || category === null} loading={pending}>
            {t("limitForm.save")}
          </Button>
          <Button variant="default" onClick={onCancel}>
            {t("limitForm.cancel")}
          </Button>
        </div>
      </Stack>
    </form>
  );
}
