// «Откуда эта цифра?» (P2, EXPL, design/DESIGN.md §4 .why): кнопка ⓘ рядом с числом; название числа — в aria-label,
// чтобы экранный диктор говорил, о какой цифре речь. Панель с формулой открывает страница (onClick).
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import classes from "./WhyButton.module.css";

export interface WhyButtonProps {
  /** Название числа: «Свободный остаток». */
  readonly subject: string;
  readonly onClick: () => void;
}

export function WhyButton({ subject, onClick }: WhyButtonProps) {
  const { t } = useTranslation("ui");
  return (
    <button
      type="button"
      className={classes.why}
      aria-label={t("why.label", { subject })}
      aria-haspopup="dialog"
      onClick={onClick}
    >
      <Info size={18} strokeWidth={1.8} aria-hidden />
    </button>
  );
}
