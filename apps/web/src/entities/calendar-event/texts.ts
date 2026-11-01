// Словарь «Календаря» — в i18next до первого показа (в первую загрузку сайта он не входит): страница календаря, карточка события в
// чате и блок событий на главной регистрируют его при показе.
import { calendarTexts } from "@kosht/i18n";
import { useTranslation } from "react-i18next";

export function useCalendarTexts(): void {
  const { i18n } = useTranslation();
  if (!i18n.hasResourceBundle("ru", "calendar")) {
    i18n.addResourceBundle("ru", "calendar", calendarTexts, true, true);
  }
}
