// Выбор периода главной (DASH-01, design/screens/Main.dc.html — переключатель месяца): стрелки «предыдущий / следующий
// месяц» и «Свой период» — календарь Mantine Dates с диапазоном (ADR-0013). Период живёт в адресе (`from`/`to`).
import { Button } from "@mantine/core";
import { DatePickerInput, DatesProvider } from "@mantine/dates";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "dayjs/locale/ru";
import { formatDate } from "@kosht/i18n";
import { useTranslation } from "react-i18next";
import classes from "./HomePage.module.css";
import { LocalDate } from "@kosht/contract";
import { monthRange, shiftMonth, wholeMonth, type Period } from "./model/period.ts";

export function PeriodBar({
  period,
  onChange,
}: {
  readonly period: Period;
  readonly onChange: (period: Period) => void;
}) {
  const { t } = useTranslation("dashboard");
  const month = wholeMonth(period);
  const title =
    month === undefined
      ? t("period.range", { from: formatDate(period.from), to: formatDate(period.to) })
      : t("period.monthYear", {
          month: t(`period.months.${month.slice(5, 7) as "01"}`),
          year: month.slice(0, 4),
        });
  const go = (by: number) => {
    onChange(monthRange(shiftMonth(month ?? period.from.slice(0, 7), by)));
  };
  return (
    <nav className={classes.periodBar} aria-label={t("period.label")}>
      <Button variant="default" size="xs" aria-label={t("period.previous")} onClick={() => go(-1)}>
        <ChevronLeft size={16} aria-hidden />
      </Button>
      <strong className={classes.periodTitle} aria-live="polite">
        {title}
      </strong>
      <Button variant="default" size="xs" aria-label={t("period.next")} onClick={() => go(1)}>
        <ChevronRight size={16} aria-hidden />
      </Button>
      <DatesProvider settings={{ locale: "ru", firstDayOfWeek: 1 }}>
        <DatePickerInput
          type="range"
          size="xs"
          aria-label={t("period.customLabel")}
          placeholder={t("period.customPlaceholder")}
          valueFormat="DD.MM.YYYY"
          value={[period.from, period.to]}
          onChange={([from, to]) => {
            if (from !== null && to !== null)
              onChange({ from: LocalDate.parse(from), to: LocalDate.parse(to) });
          }}
          className={classes.range}
        />
      </DatesProvider>
    </nav>
  );
}
