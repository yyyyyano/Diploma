// Словарь вкладки «Telegram» — в i18next до первого показа вкладки (в первую загрузку сайта он не входит).
import { telegramTexts } from "@kosht/i18n";
import { useTranslation } from "react-i18next";

export function useTelegramTexts(): void {
  const { i18n } = useTranslation();
  if (!i18n.hasResourceBundle("ru", "telegram")) {
    i18n.addResourceBundle("ru", "telegram", telegramTexts, true, true);
  }
}
