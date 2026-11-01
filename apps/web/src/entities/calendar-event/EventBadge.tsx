// Значок типа события в цветной плашке (CAL-01): значок декоративный — тип назван текстом рядом (NFR-20).
import type { CalendarType } from "@kosht/contract";
import { EVENT_ICONS } from "./icons.ts";
import classes from "./calendar-event.module.css";

export function EventBadge({ type }: { readonly type: CalendarType }) {
  const Icon = EVENT_ICONS[type];
  return (
    <span className={classes.badge} data-type={type} aria-hidden="true">
      <Icon size={16} strokeWidth={1.8} />
    </span>
  );
}
