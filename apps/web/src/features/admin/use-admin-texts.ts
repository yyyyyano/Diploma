// Словарь администрирования — вместе с разделом, а не с первой загрузкой сайта (бюджет 300 КБ gzip, CONSTRAINTS): каркас
// раздела регистрирует его в i18next до первого показа текстов, все страницы вкладок лежат внутри каркаса.
import { adminTexts } from "@kosht/i18n";
import { useTranslation } from "react-i18next";

export function useAdminTexts(): void {
  const { i18n } = useTranslation();
  if (!i18n.hasResourceBundle("ru", "admin")) {
    i18n.addResourceBundle("ru", "admin", adminTexts, true, true);
  }
}
