// DES-17, NFR-23: дата «21.10.2026» и день относительно сегодня («завтра», «через 3 дн.»). Только календарная
// арифметика над LocalDate — без часов и без Intl: какой сейчас день по поясу системы, решают
// LocalDate.fromInstant и Clock.today() (kernel), а сюда «сегодня» приходит аргументом.
import type { LocalDate } from "@kosht/kernel";
import { createT } from "./create-t.ts";

const t = createT();

/** Насколько близкие дни подписываются словами; дальше — дата. */
const NEAR_DAYS = 7;

/** «ГГГГ-ММ-ДД» → «ДД.ММ.ГГГГ». */
export function formatDate(date: LocalDate): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

/**
 * Номер дня от 1970-01-01 по пролептическому григорианскому календарю (алгоритм days_from_civil Х. Хиннанта):
 * целые числа, без Date — Date.UTC превращает годы 0–99 в 1900–1999.
 */
function dayNumber(date: LocalDate): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const year = m <= 2 ? y - 1 : y;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/** «сегодня», «вчера», «завтра», «послезавтра», «через N дн.», «N дн. назад» до недели; дальше — `formatDate`. */
export function formatRelativeDay(date: LocalDate, today: LocalDate): string {
  const diff = dayNumber(date) - dayNumber(today);
  if (diff === 0) return t("common:relativeDay.today");
  if (diff === -1) return t("common:relativeDay.yesterday");
  if (diff === 1) return t("common:relativeDay.tomorrow");
  if (diff === 2) return t("common:relativeDay.dayAfterTomorrow");
  if (diff > 2 && diff <= NEAR_DAYS) return t("common:relativeDay.inDays", { count: diff });
  if (diff < -1 && diff >= -NEAR_DAYS) return t("common:relativeDay.daysAgo", { count: -diff });
  return formatDate(date);
}
