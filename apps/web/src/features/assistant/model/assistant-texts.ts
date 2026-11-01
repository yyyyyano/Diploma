// Словарь чата — вместе с чатом, а не с первой загрузкой сайта (бюджет 300 КБ gzip, CONSTRAINTS): страница и панель
// регистрируют его в i18next до первого показа текстов, как «Таблица ставок» (`rates`). Подпись плавающей кнопки лежит
// в `shell` — она нужна до того, как чат загрузится.
import { assistantTexts } from "@kosht/i18n";
import { useTranslation } from "react-i18next";

export function useAssistantTexts(): void {
  const { i18n } = useTranslation();
  if (!i18n.hasResourceBundle("ru", "assistant")) {
    i18n.addResourceBundle("ru", "assistant", assistantTexts, true, true);
  }
}
