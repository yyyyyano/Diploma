// Вместо микрофона по сети (VOICE-02, MobileChat): getUserMedia работает только на localhost, поэтому на телефоне и по
// адресу в сети голос недоступен — подсказка «Надиктуйте в Telegram». Закрывается; до перезагрузки не возвращается.
import { Mic, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import classes from "./VoiceHint.module.css";

export function VoiceHint() {
  const { t } = useTranslation("assistant");
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  return (
    <div className={classes.hint} role="note">
      <Mic size={18} strokeWidth={1.8} aria-hidden />
      <p>
        {t("voice.networkTitle")} <strong>{t("voice.networkTelegram")}</strong>
      </p>
      <button
        type="button"
        className={classes.close}
        aria-label={t("voice.dismiss")}
        onClick={() => setClosed(true)}
      >
        <X size={18} strokeWidth={1.8} aria-hidden />
      </button>
    </div>
  );
}
