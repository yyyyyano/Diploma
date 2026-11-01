// Строка события — список «Ближайшие», день, блок на главной (CAL-01, DASH-02): дата, значок типа, название, «тип · день недели ·
// через N дней», сумма. Сумма приходит готовой (P1); у платежа — «−», у поступления — «+», у прогноза по истории — «≈».
import type { CalendarEntry } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import type { LocalDate } from "@kosht/kernel";
import { useTranslation } from "react-i18next";
import { Money } from "../../ui/index.ts";
import classes from "./calendar-event.module.css";
import { EventBadge } from "./EventBadge.tsx";
import { dayParts, eventTitle, monthGenitive, relativeText, weekdayName } from "./format.ts";
import { useCalendarTexts } from "./texts.ts";

export interface EventRowProps {
  readonly entry: CalendarEntry;
  readonly today: LocalDate;
  /** Показывать дату слева (список) или нет (день: дата уже в заголовке). */
  readonly showDate?: boolean;
  readonly onOpen?: () => void;
  readonly href?: string;
}

export function EventRow({ entry, today, showDate = true, onOpen, href }: EventRowProps) {
  useCalendarTexts();
  const { t } = useTranslation(["calendar", "notifications"]);
  const title = eventTitle(t, entry);
  const on = entry.on;
  const parts = on === null ? null : dayParts(on);
  const meta = [
    t(`calendar:types.${entry.type}`),
    ...(on === null
      ? [t("calendar:event.noDate")]
      : [weekdayName(t, on, true), relativeText(t, on, today)]),
  ].join(" · ");
  const body = (
    <>
      {showDate && (
        <span className={classes.dateBox} aria-hidden="true">
          <b>{parts === null ? "—" : parts.day}</b>
          <small>{parts === null ? "" : monthGenitive(t, parts.month, true)}</small>
        </span>
      )}
      <EventBadge type={entry.type} />
      <span className={classes.text}>
        <span className={classes.title}>{title}</span>
        <span className={classes.meta}>{meta}</span>
      </span>
      {entry.amount !== null && (
        <span className={classes.amount}>
          {entry.approx && "≈ "}
          <Money value={entry.amount} kind={entry.direction === "in" ? "income" : "expense"} />
        </span>
      )}
    </>
  );
  const label = [title, on === null ? "" : formatDate(on)].filter((part) => part !== "").join(", ");
  if (href !== undefined) {
    return (
      <a className={classes.row} href={href} aria-label={label}>
        {body}
      </a>
    );
  }
  return onOpen === undefined ? (
    <div className={classes.row}>{body}</div>
  ) : (
    <button type="button" className={classes.row} onClick={onOpen} aria-label={label}>
      {body}
    </button>
  );
}
