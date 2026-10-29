// Название провайдера ИИ для людей (Groq, Z.ai, «Локальная модель»): неизвестный провайдер — по идентификатору.
import { useTranslation } from "react-i18next";

export function useProviderName(): (id: string) => string {
  const { t } = useTranslation("admin");
  const names: Readonly<Record<string, string>> = {
    groq: t("ai.providerNames.groq"),
    zai: t("ai.providerNames.zai"),
    llama: t("ai.providerNames.llama"),
    test: t("ai.providerNames.test"),
  };
  return (id) => names[id] ?? id;
}
