// Окна «Исправить сумму и дату» и «Добавить вручную» (REC-02): сумма, период, день; вход проверяет схема контракта —
// та же, что на сервере. Кнопка «Сохранить» / «Добавить» неактивна, пока сумма не больше нуля.
import {
  RECURRING_PERIODS,
  RecurringCreateInput,
  RecurringEditInput,
  RecurringPeriod,
  type RecurringItem,
  type RecurringSection,
} from "@kosht/contract";
import { formatMoneyParts, parseMoney } from "@kosht/i18n";
import { Button, SegmentedControl, Select, Stack, TextInput } from "@mantine/core";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import classes from "./RecurringPage.module.css";
import { SECTIONS, type T } from "./model/format.ts";

function periodOptions(t: T) {
  return RECURRING_PERIODS.map((value) => ({ value, label: t(`period.name.${value}`) }));
}

export function EditForm({
  item,
  pending,
  onSubmit,
  onCancel,
}: {
  readonly item: RecurringItem;
  readonly pending: boolean;
  readonly onSubmit: (input: ReturnType<typeof RecurringEditInput.parse>) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation("recurring");
  const [amount, setAmount] = useState(formatMoneyParts(item.amount).amount);
  const [period, setPeriod] = useState<string>(item.period);
  const [day, setDay] = useState(item.anchorDay === null ? "" : String(item.anchorDay));
  const parsed = parseMoney(amount, "BYN");
  const input = RecurringEditInput.safeParse({
    id: item.id,
    ...(parsed === undefined ? {} : { amount: parsed }),
    period,
    ...(period !== "week" && day !== "" ? { anchorDay: Number(day) } : {}),
  });
  const valid = input.success && parsed !== undefined && parsed.minor > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (input.success && valid) onSubmit(input.data);
  };
  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <p className={classes.muted}>{t("edit.hint")}</p>
        <TextInput
          label={t("edit.amount")}
          inputMode="decimal"
          value={amount}
          error={!valid && amount !== "" ? t("edit.amountInvalid") : null}
          onChange={(event) => setAmount(event.currentTarget.value)}
        />
        <div className={classes.pair}>
          <Select
            label={t("edit.period")}
            allowDeselect={false}
            value={period}
            onChange={(value) => value !== null && setPeriod(RecurringPeriod.parse(value))}
            data={periodOptions(t)}
          />
          {period !== "week" && (
            <TextInput
              label={t("edit.day")}
              inputMode="numeric"
              maxLength={2}
              value={day}
              onChange={(event) => setDay(event.currentTarget.value.replace(/\D/g, ""))}
            />
          )}
        </div>
        <div className={classes.buttons}>
          <Button type="submit" disabled={!valid} loading={pending}>
            {t("edit.save")}
          </Button>
          <Button variant="default" onClick={onCancel}>
            {t("edit.cancel")}
          </Button>
        </div>
      </Stack>
    </form>
  );
}

export function AddForm({
  pending,
  onSubmit,
  onCancel,
}: {
  readonly pending: boolean;
  readonly onSubmit: (input: ReturnType<typeof RecurringCreateInput.parse>) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation("recurring");
  const [section, setSection] = useState<RecurringSection>("mandatory");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<string>("month");
  const [day, setDay] = useState("");
  const parsed = parseMoney(amount, "BYN");
  const input = RecurringCreateInput.safeParse({
    name,
    section,
    ...(parsed === undefined ? {} : { amount: parsed }),
    period,
    ...(period !== "week" && day !== "" ? { anchorDay: Number(day) } : {}),
  });
  const valid = input.success && parsed !== undefined && parsed.minor > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (input.success && valid) onSubmit(input.data);
  };
  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <div>
          <p className={classes.label} id="rec-kind">
            {t("create.kind")}
          </p>
          <SegmentedControl
            aria-labelledby="rec-kind"
            fullWidth
            value={section}
            onChange={(value) => setSection(value as RecurringSection)}
            data={SECTIONS.map((value) => ({ value, label: t(`create.kinds.${value}`) }))}
            className={classes.kinds}
          />
          <p className={classes.muted}>{t(`create.hints.${section}`)}</p>
        </div>
        <TextInput
          label={t("create.name")}
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <div className={classes.pair}>
          <TextInput
            label={t("create.amount")}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.currentTarget.value)}
          />
          <Select
            label={t("create.period")}
            allowDeselect={false}
            value={period}
            onChange={(value) => value !== null && setPeriod(RecurringPeriod.parse(value))}
            data={periodOptions(t)}
          />
          {period !== "week" && (
            <TextInput
              label={t("create.day")}
              inputMode="numeric"
              maxLength={2}
              value={day}
              onChange={(event) => setDay(event.currentTarget.value.replace(/\D/g, ""))}
            />
          )}
        </div>
        {!valid && (name !== "" || amount !== "") && (
          <p className={classes.muted}>{t("create.invalid")}</p>
        )}
        <div className={classes.buttons}>
          <Button type="submit" disabled={!valid} loading={pending}>
            {t("create.submit")}
          </Button>
          <Button variant="default" onClick={onCancel}>
            {t("create.cancel")}
          </Button>
        </div>
      </Stack>
    </form>
  );
}
