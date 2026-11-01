// Поле вопроса (design: .as-compose/.as-box, VOICE-02, CHAT-07): текст, микрофон и «Отправить» / «Остановить» в одной
// рамке. Микрофон есть только на localhost (VOICE-02): запись → текст в это же поле для правки, без отправки. Состояние
// записи и ошибки голоса — в живой области под полем: диктор слышит, что запись идёт и чем кончилась.
import { ActionIcon, Textarea } from "@mantine/core";
import { CircleAlert, Loader2, Mic, SendHorizontal, Square } from "lucide-react";
import type { FormEvent, KeyboardEvent, Ref } from "react";
import { useTranslation } from "react-i18next";
import classes from "./Composer.module.css";
import type { VoiceInput } from "./model/use-voice-input.ts";

export interface ComposerProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  /** Ответ идёт: вместо «Отправить» — «Остановить» (если можно остановить). */
  readonly busy: boolean;
  readonly onStop: (() => void) | undefined;
  readonly voice: VoiceInput;
  readonly placeholder: string;
  readonly inputRef?: Ref<HTMLTextAreaElement>;
  /** Короткая подпись под полем (оговорка про суммы); в панели не показывается. */
  readonly note?: string;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  onStop,
  voice,
  placeholder,
  inputRef,
  note,
}: ComposerProps) {
  const { t } = useTranslation("assistant");
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (value.trim() !== "" && !busy) onSubmit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };
  const recording = voice.status === "recording";
  const working = voice.status === "working";
  return (
    <div className={classes.compose}>
      <form className={classes.box} onSubmit={submit}>
        <Textarea
          className={classes.input}
          variant="unstyled"
          autosize
          minRows={1}
          maxRows={5}
          maxLength={4000}
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={t("inputLabel")}
        />
        {voice.mode === "available" && (
          <ActionIcon
            variant={recording ? "filled" : "subtle"}
            color={recording ? "var(--danger)" : "gray"}
            size={44}
            radius="xl"
            aria-label={recording ? t("voice.stop") : t("voice.start")}
            aria-pressed={recording}
            disabled={working}
            onClick={() => (recording ? voice.stop() : voice.start())}
          >
            {working ? (
              <Loader2 className={classes.spin} size={20} strokeWidth={1.8} aria-hidden />
            ) : recording ? (
              <Square size={18} strokeWidth={1.8} aria-hidden />
            ) : (
              <Mic size={20} strokeWidth={1.8} aria-hidden />
            )}
          </ActionIcon>
        )}
        {busy && onStop !== undefined ? (
          <ActionIcon size={44} radius="xl" aria-label={t("stop")} onClick={onStop}>
            <Square size={18} strokeWidth={1.8} aria-hidden />
          </ActionIcon>
        ) : (
          <ActionIcon
            size={44}
            radius="xl"
            type="submit"
            aria-label={t("send")}
            disabled={value.trim() === "" || busy}
          >
            <SendHorizontal size={20} strokeWidth={1.8} aria-hidden />
          </ActionIcon>
        )}
      </form>
      <output className={classes.status}>
        {recording && t("voice.recording")}
        {working && t("voice.working")}
      </output>
      {voice.error !== undefined && (
        <p className={classes.voiceError} role="alert">
          <CircleAlert size={16} strokeWidth={1.8} aria-hidden />
          {t(`voice.${voice.error}`, { retryAfterMinutes: voice.retryAfterMinutes })}
        </p>
      )}
      {note !== undefined && <p className={classes.note}>{note}</p>}
    </div>
  );
}
