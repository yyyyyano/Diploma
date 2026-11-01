// Публичный вход сущности «событие календаря» (CAL-01, CAL-06, DASH-02, CHAT-04): значок типа, строка события, подписи и словарь
// календаря — для страницы календаря, карточки события в чате и блока событий на главной.
export { EventBadge } from "./EventBadge.tsx";
export { EventRow, type EventRowProps } from "./EventRow.tsx";
export {
  cellLabel,
  dayParts,
  eventTitle,
  fullDate,
  monthGenitive,
  originText,
  relativeText,
  weekdayName,
  weekdayOf,
  type CalendarT,
} from "./format.ts";
export { EVENT_ICONS } from "./icons.ts";
export { useCalendarTexts } from "./texts.ts";
