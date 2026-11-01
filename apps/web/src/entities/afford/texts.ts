// Словарь «Могу ли я позволить покупку?» — в i18next до первого показа (в первую загрузку сайта он не входит).
import { affordTexts } from "@kosht/i18n";
import { useTranslation } from "react-i18next";

export function useAffordTexts(): void {
  const { i18n } = useTranslation();
  if (!i18n.hasResourceBundle("ru", "afford")) {
    i18n.addResourceBundle("ru", "afford", affordTexts, true, true);
  }
}
