// Словарь «Итогов недели» — в i18next до первого показа (в первую загрузку сайта он не входит).
import { weeklyTexts } from "@kosht/i18n";
import { useTranslation } from "react-i18next";

export function useWeeklyTexts(): void {
  const { i18n } = useTranslation();
  if (!i18n.hasResourceBundle("ru", "weekly")) {
    i18n.addResourceBundle("ru", "weekly", weeklyTexts, true, true);
  }
}
