// Переписка и поле вопроса — общая часть страницы «Ассистент» и боковой панели (CHAT-02, CHAT-08, CHAT-09, NFR-21).
// Ответ приходит потоком (useChat поверх процедур oRPC): текст по мере генерации, шаг агента — подписью из словаря.
// Лента — role="log" с aria-live="off": диктор не читает каждый кусок, вехи («отвечает», «готово») идут отдельной
// скрытой живой областью. Ответ, который сервер ещё пишет (вкладку перезагрузили), показан «ещё отвечает…» и
// обновляется по сигналу chat-message: история приходит запросом, а не потоком. «Остановить» — chat.stop(runId).
import type { ChatMessage, ConversationId, PageContext } from "@kosht/contract";
import { useChat } from "@ai-sdk/react";
import { Button, VisuallyHidden } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assistantBridge } from "../../lib/assistant-bridge.ts";
import { client, orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { Composer } from "./Composer.tsx";
import classes from "./ChatView.module.css";
import { LocalModeBanner } from "./LocalModeBanner.tsx";
import { MessageView } from "./MessageView.tsx";
import { VoiceHint } from "./VoiceHint.tsx";
import { metadataOf, toUiMessages } from "./model/messages.ts";
import { createChatTransport } from "./model/transport.ts";
import { useVoiceInput } from "./model/use-voice-input.ts";

/** Подсказки пустого диалога страницы (CHAT-09): четыре группы по сценариям макета. */
const IDEAS = [
  { title: "ideas.spending.title", questions: ["ideas.spending.q1", "ideas.spending.q2"] },
  { title: "ideas.deductions.title", questions: ["ideas.deductions.q1"] },
  { title: "ideas.consumer.title", questions: ["ideas.consumer.q1"] },
  { title: "ideas.purchase.title", questions: ["ideas.purchase.q1", "ideas.purchase.q2"] },
] as const;

const PANEL_IDEAS = ["panelIdeas.q1", "panelIdeas.q2", "panelIdeas.q3"] as const;
const FOLLOW_UPS = ["follow.lastMonth", "follow.operations", "follow.why"] as const;

export interface ChatViewProps {
  readonly variant: "page" | "panel";
  /** Открытый диалог; null — новый, создаётся первым вопросом. */
  readonly conversationId: ConversationId | null;
  /** Сообщения диалога с сервера: начальные и обновления по сигналу chat-message. */
  readonly serverMessages: readonly ChatMessage[];
  /** Контекст страницы на момент вопроса (CHAT-08). */
  readonly getPage: () => PageContext | undefined;
  /** Новый диалог получил id (первый ответ): страница обновляет адрес и подсветку в списке. */
  readonly onConversation: (id: ConversationId) => void;
  /** Имя для приветствия пустого диалога. */
  readonly userName?: string | undefined;
}

export function ChatView({
  variant,
  conversationId,
  serverMessages,
  getPage,
  onConversation,
  userName,
}: ChatViewProps) {
  const { t } = useTranslation("assistant");
  const queryClient = useQueryClient();
  // Транспорт создаётся один раз: диалог (из истории или первого ответа) он запоминает сам.
  const [transport] = useState(() => createChatTransport(client, conversationId));
  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    transport,
    messages: toUiMessages(serverMessages),
    // История на сервере дописана — список диалогов и история обновятся без ожидания сигнала.
    onFinish: () => void queryClient.invalidateQueries({ queryKey: orpc.chat.key() }),
  });
  const stopRun = useMutation(orpc.chat.stop.mutationOptions());
  const [text, setText] = useState(() => assistantBridge.getState().pendingQuestion ?? "");
  const [stopped, setStopped] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(status);
  // Свежий статус для эффекта ниже — без записи в ref во время рендера.
  useEffect(() => {
    statusRef.current = status;
  });
  const localBusy = status === "submitted" || status === "streaming";
  const last = serverMessages.at(-1);
  // Ответ пишет сервер, а вкладка его не слушает (перезагрузка, второй экран): ждём сигнал chat-message.
  const remoteBusy = !localBusy && last?.role === "assistant" && last.status === "streaming";
  const busy = localBusy || remoteBusy;

  // Сервер дописал ответ или сообщения изменились в другой вкладке: берём историю, пока свой поток не идёт.
  useEffect(() => {
    // Статус — из ref: перезапись нужна только при новых данных сервера, а не при смене статуса потока.
    if (statusRef.current === "submitted" || statusRef.current === "streaming") return;
    setMessages(toUiMessages(serverMessages));
  }, [serverMessages, setMessages]);

  // Первый ответ нового диалога называет его id (RunMetadata в куске start).
  const startedId = metadataOf(
    messages.findLast((message) => message.role === "assistant"),
  ).conversationId;
  useEffect(() => {
    if (startedId !== undefined && startedId !== conversationId) {
      onConversation(startedId as ConversationId);
    }
  }, [startedId, conversationId, onConversation]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, status]);

  const voice = useVoiceInput({
    onText: (spoken) => {
      setText((current) => (current.trim() === "" ? spoken : `${current.trimEnd()} ${spoken}`));
      inputRef.current?.focus();
    },
  });

  // Вопрос из другого места сайта («Спросить ассистента об этой статье») — в поле, не в отправку: он уже мог лежать в
  // мосте до открытия чата (телефон: страница чата открывается позже) или прийти, пока чат открыт.
  useEffect(() => {
    if (assistantBridge.takeQuestion() !== undefined) inputRef.current?.focus();
    return assistantBridge.subscribe(() => {
      const question = assistantBridge.takeQuestion();
      if (question === undefined) return;
      setText(question);
      inputRef.current?.focus();
    });
  }, []);

  const send = (question: string) => {
    const trimmed = question.trim();
    if (trimmed === "" || busy) return;
    setText("");
    setStopped(false);
    void sendMessage({ text: trimmed }, { body: { page: getPage() } });
  };

  const onStop = () => {
    const runId = metadataOf(messages.at(-1)).runId;
    if (runId !== undefined) stopRun.mutate({ runId: runId as never });
    setStopped(true);
    void stop();
  };

  const failure =
    error === undefined
      ? undefined
      : errorCodeOf(error) === "RATE_LIMITED"
        ? t("rateLimited", { retryAfterMinutes: errorParamsOf(error).retryAfterMinutes })
        : t("error");

  const milestone = localBusy
    ? t("answering")
    : remoteBusy
      ? t("stillAnswering")
      : error !== undefined
        ? (failure ?? "")
        : stopped
          ? t("stopped")
          : messages.length > 0
            ? t("answered")
            : "";

  const empty = messages.length === 0;
  const afterAnswer = !busy && messages.at(-1)?.role === "assistant" && error === undefined;

  return (
    <div className={`${classes.view} ${variant === "panel" ? classes.panel : classes.page}`}>
      <LocalModeBanner />
      <div className={classes.body}>
        <div className={classes.col}>
          {empty && variant === "page" && <Welcome name={userName} onPick={send} />}
          {empty && variant === "panel" && (
            <div className={classes.panelHello}>
              <p className={classes.helloText}>{t("welcome.text")}</p>
              <ul className={classes.chips} aria-label={t("panelIdeas.label")}>
                {PANEL_IDEAS.map((key) => (
                  <li key={key}>
                    <Button variant="default" radius="xl" onClick={() => send(t(key))}>
                      {t(key)}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <section className={classes.feed} role="log" aria-live="off" aria-label={t("feedLabel")}>
            {messages.map((message) => (
              <MessageView key={message.id} message={message} />
            ))}
            {failure !== undefined && (
              <p className={classes.error} role="alert">
                <CircleAlert size={18} strokeWidth={1.8} aria-hidden />
                {failure}
              </p>
            )}
          </section>
          {afterAnswer && (
            <ul className={classes.chips} aria-label={t("follow.label")}>
              {FOLLOW_UPS.map((key) => (
                <li key={key}>
                  <Button variant="default" radius="xl" onClick={() => send(t(key))}>
                    {t(key)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <VisuallyHidden>
        <output aria-live="polite">{milestone}</output>
      </VisuallyHidden>
      <div className={classes.compose}>
        {voice.mode === "network" && <VoiceHint />}
        <Composer
          value={text}
          onChange={setText}
          onSubmit={() => send(text)}
          busy={busy}
          onStop={localBusy ? onStop : undefined}
          voice={voice}
          inputRef={inputRef}
          placeholder={variant === "panel" ? t("placeholderShort") : t("placeholder")}
          {...(variant === "page" ? { note: t("note") } : {})}
        />
      </div>
    </div>
  );
}

/** Пустой диалог страницы (design: .as-empty): приветствие и подсказки по четырём сценариям. */
function Welcome({
  name,
  onPick,
}: {
  readonly name: string | undefined;
  readonly onPick: (question: string) => void;
}) {
  const { t } = useTranslation("assistant");
  return (
    <div className={classes.welcome}>
      <span className={classes.hero}>
        <Sparkles size={26} strokeWidth={1.8} aria-hidden />
      </span>
      <h2 className={classes.helloTitle}>
        {name === undefined || name === "" ? t("welcome.titleAnon") : t("welcome.title", { name })}
      </h2>
      <p className={classes.helloText}>{t("welcome.text")}</p>
      <div className={classes.ideas}>
        {IDEAS.map((group) => (
          <section key={group.title} className={classes.idea} aria-label={t(group.title)}>
            <h3 className={classes.ideaTitle}>{t(group.title)}</h3>
            {group.questions.map((key) => (
              <button
                key={key}
                type="button"
                className={classes.ideaButton}
                onClick={() => onPick(t(key))}
              >
                {t(key)}
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
