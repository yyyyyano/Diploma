// Безопасный запасной вид части ответа (CHAT-04): часть не по схеме реестра или неизвестная — вместо карточки одна строка,
// ответ ассистента выше остаётся в силе. Сами данные части не показываются: что не прошло схему, того не рисуем.
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import classes from "./cards.module.css";

export function Unavailable() {
  const { t } = useTranslation("assistant");
  return (
    <p className={classes.line}>
      <Info size={16} strokeWidth={1.8} aria-hidden />
      {t("cards.unavailable")}
    </p>
  );
}
