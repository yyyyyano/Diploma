// Код восстановления (AUTH-05, design/screens/Setup.dc.html шаг 2, Settings.dc.html): показывается один раз — крупно,
// группами по 4 знака, табличными цифрами, с кнопкой «Скопировать». Общий для первого запуска, входа с кодом и
// настроек; что делать дальше («Я сохранил(а) код») решает экран.
import { Button } from "@mantine/core";
import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import classes from "./RecoveryCode.module.css";

export interface RecoveryCodeProps {
  readonly code: string;
}

export function RecoveryCode({ code }: RecoveryCodeProps) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  return (
    <div className={classes.box}>
      <p className={classes.label}>
        <KeyRound size={16} strokeWidth={1.8} aria-hidden />
        {t("recoveryCode.label")}
      </p>
      <p className={classes.code}>{code}</p>
      <Button
        variant="default"
        leftSection={
          copied ? (
            <Check size={16} strokeWidth={1.8} aria-hidden />
          ) : (
            <Copy size={16} strokeWidth={1.8} aria-hidden />
          )
        }
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => setCopied(true));
        }}
      >
        {copied ? t("recoveryCode.copied") : t("recoveryCode.copy")}
      </Button>
    </div>
  );
}
