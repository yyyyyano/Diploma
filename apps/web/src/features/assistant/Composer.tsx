// Поле вопроса (design: .as-compose/.as-box, VOICE-02, CHAT-07, CHAT-03): скрепка (чек или выписка), текст, микрофон и
// «Отправить» / «Остановить» в одной рамке; принятые вложения — чипами над полем. Микрофон есть только на localhost (VOICE-02): запись → текст в это же поле для правки, без отправки. Состояние
// записи и ошибки голоса — в живой области под полем: диктор слышит, что запись идёт и чем кончилась.
import { ActionIcon, Menu, Textarea } from "@mantine/core";
import {
  CircleAlert,
  FileSpreadsheet,
  Loader2,
  Mic,
  Paperclip,
  Receipt,
  SendHorizontal,
  Square,
  X,
} from "lucide-react";
import { useRef, type ChangeEvent, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { useTranslation } from "react-i18next";
import classes from "./Composer.module.css";
import type { Attachments } from "./model/use-attachments.ts";
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
  /** Вложения (CHAT-03); без них скрепки нет. */
  readonly attachments?: Attachments;
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
  attachments,
}: ComposerProps) {
  const { t } = useTranslation("assistant");
  const receiptInput = useRef<HTMLInputElement>(null);
  const statementInput = useRef<HTMLInputElement>(null);
  const hasAttachments = (attachments?.items.length ?? 0) > 0;
  const ready = (value.trim() !== "" || hasAttachments) && attachments?.uploading !== true;
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (ready && !busy) onSubmit();
  };
  const picked = (kind: "receipt" | "statement") => (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    // Тот же файл можно выбрать снова (после «Убрать»): значение поля сбрасывается.
    event.currentTarget.value = "";
    if (files.length > 0) void attachments?.attach(kind, files);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };
  const recording = voice.status === "recording";
  const working = voice.status === "working";
  return (
    <div className={classes.compose}>
      {attachments !== undefined && hasAttachments && (
        <ul className={classes.attached} aria-label={t("attach.list")}>
          {attachments.items.map((item) => (
            <li key={item.id} className={classes.chip}>
              {item.kind === "receipt" ? (
                <Receipt size={14} strokeWidth={1.8} aria-hidden />
              ) : (
                <FileSpreadsheet size={14} strokeWidth={1.8} aria-hidden />
              )}
              <span className={classes.chipName}>
                {item.name === "" ? t(`cards.attachment.${item.kind}`) : item.name}
              </span>
              <ActionIcon
                variant="subtle"
                size={28}
                radius="xl"
                aria-label={t("attach.remove", { name: item.name })}
                onClick={() => attachments.remove(item.id)}
              >
                <X size={14} strokeWidth={1.8} aria-hidden />
              </ActionIcon>
            </li>
          ))}
        </ul>
      )}
      <form className={classes.box} onSubmit={submit}>
        {attachments !== undefined && (
          <>
            <Menu position="top-start" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={44}
                  radius="xl"
                  aria-label={t("attach.button")}
                  disabled={attachments.full || attachments.uploading}
                >
                  {attachments.uploading ? (
                    <Loader2 className={classes.spin} size={20} strokeWidth={1.8} aria-hidden />
                  ) : (
                    <Paperclip size={20} strokeWidth={1.8} aria-hidden />
                  )}
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown aria-label={t("attach.menu")}>
                <Menu.Item
                  leftSection={<Receipt size={16} strokeWidth={1.8} aria-hidden />}
                  onClick={() => receiptInput.current?.click()}
                >
                  {t("attach.receipt")}
                </Menu.Item>
                <Menu.Item
                  leftSection={<FileSpreadsheet size={16} strokeWidth={1.8} aria-hidden />}
                  onClick={() => statementInput.current?.click()}
                >
                  {t("attach.statement")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <input
              ref={receiptInput}
              type="file"
              hidden
              multiple
              accept="image/*,.heic"
              aria-label={t("attach.receipt")}
              onChange={picked("receipt")}
            />
            <input
              ref={statementInput}
              type="file"
              hidden
              accept=".pdf,.xlsx,.xls,.csv,.txt,image/*"
              aria-label={t("attach.statement")}
              onChange={picked("statement")}
            />
          </>
        )}
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
            disabled={!ready || busy}
          >
            <SendHorizontal size={20} strokeWidth={1.8} aria-hidden />
          </ActionIcon>
        )}
      </form>
      <output className={classes.status}>
        {recording && t("voice.recording")}
        {working && t("voice.working")}
        {attachments?.uploading === true && t("attach.uploading")}
      </output>
      {attachments?.error !== undefined && (
        <p className={classes.voiceError} role="alert">
          <CircleAlert size={16} strokeWidth={1.8} aria-hidden />
          {attachments.error}
        </p>
      )}
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
