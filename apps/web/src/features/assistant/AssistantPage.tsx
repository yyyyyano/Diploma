// «Ассистент» (design/screens/Assistant.dc.html, CHAT-02, NFR-21): лента диалога и поле вопроса. Ответ приходит
// потоком (useChat поверх процедур oRPC): текст — по мере генерации, шаг агента — подписью из словаря tools по имени
// инструмента (не текстом модели), результат list_accounts — карточками счетов. Лента — role="log" с aria-live="off",
// вехи («отвечает», «готово») — отдельной скрытой живой областью: диктор не читает каждый кусок. «Остановить» —
// chat.stop(runId): запуск на сервере освобождает модель; закрытая вкладка ответ не обрывает — он придёт историей.
import type { AccountListItem, ChatMessage, ConversationId } from "@kosht/contract";
import { useChat } from "@ai-sdk/react";
import { ActionIcon, Button, Textarea, VisuallyHidden } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import {
  CheckCircle2,
  Loader2,
  SendHorizontal,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { AccountCard } from "../../entities/account/index.ts";
import { client, orpc } from "../../lib/api.ts";
import { EmptyState, PageHeader, SkeletonText } from "../../ui/index.ts";
import classes from "./AssistantPage.module.css";
import { metadataOf, toUiMessages } from "./model/messages.ts";
import { createChatTransport } from "./model/transport.ts";

export function AssistantPage() {
  const history = useQuery(orpc.chat.history.queryOptions());
  if (history.isError) {
    return (
      <Frame>
        <ErrorState onRetry={() => void history.refetch()} />
      </Frame>
    );
  }
  if (history.isPending) {
    return (
      <Frame>
        <SkeletonText lines={4} />
      </Frame>
    );
  }
  return (
    <Chat
      conversationId={history.data?.conversationId ?? null}
      initial={history.data?.messages ?? []}
    />
  );
}

function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  const { t } = useTranslation("assistant");
  return (
    <EmptyState
      tone="error"
      icon={TriangleAlert}
      title={t("historyError.title")}
      description={t("historyError.text")}
      actions={<Button onClick={onRetry}>{t("historyError.retry")}</Button>}
    />
  );
}

function Frame({ children }: { readonly children: React.ReactNode }) {
  const { t } = useTranslation("assistant");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className={classes.body}>{children}</div>
    </>
  );
}

function Chat({
  conversationId,
  initial,
}: {
  readonly conversationId: ConversationId | null;
  readonly initial: readonly ChatMessage[];
}) {
  const { t } = useTranslation(["assistant", "tools"]);
  const queryClient = useQueryClient();
  // Транспорт создаётся один раз: диалог (из истории или первого ответа) он запоминает сам.
  const [transport] = useState(() => createChatTransport(client, conversationId));
  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
    messages: toUiMessages(initial),
    // История на сервере дописана — следующий заход покажет её без ожидания.
    onFinish: () => void queryClient.invalidateQueries({ queryKey: orpc.chat.history.key() }),
  });
  const stopRun = useMutation(orpc.chat.stop.mutationOptions());
  const [text, setText] = useState("");
  const [stopped, setStopped] = useState(false);
  const busy = status === "submitted" || status === "streaming";

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const question = text.trim();
    if (question === "" || busy) return;
    setText("");
    setStopped(false);
    void sendMessage({ text: question });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) submit(event);
  };

  const onStop = () => {
    const runId = metadataOf(messages.at(-1)).runId;
    if (runId !== undefined) stopRun.mutate({ runId: runId as never });
    setStopped(true);
    void stop();
  };

  const milestone = busy
    ? t("answering")
    : error !== undefined
      ? t("error")
      : stopped
        ? t("stopped")
        : messages.length > 0
          ? t("answered")
          : "";

  return (
    <Frame>
      <div className={classes.chat}>
        <section className={classes.feed} role="log" aria-live="off" aria-label={t("feedLabel")}>
          {messages.length === 0 && <p className={classes.empty}>{t("empty")}</p>}
          {messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
          {error !== undefined && (
            <p className={classes.error} role="alert">
              <TriangleAlert size={18} strokeWidth={1.8} aria-hidden />
              {t("error")}
            </p>
          )}
        </section>
        <VisuallyHidden>
          <output aria-live="polite">{milestone}</output>
        </VisuallyHidden>
        <form className={classes.composer} onSubmit={submit}>
          <Textarea
            className={classes.input}
            aria-label={t("inputLabel")}
            placeholder={t("placeholder")}
            autosize
            minRows={1}
            maxRows={6}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          {busy ? (
            <ActionIcon size={44} variant="light" aria-label={t("stop")} onClick={onStop}>
              <Square size={18} strokeWidth={1.8} aria-hidden />
            </ActionIcon>
          ) : (
            <ActionIcon
              size={44}
              type="submit"
              aria-label={t("send")}
              disabled={text.trim() === ""}
            >
              <SendHorizontal size={20} strokeWidth={1.8} aria-hidden />
            </ActionIcon>
          )}
        </form>
        <p className={classes.note}>{t("note")}</p>
      </div>
    </Frame>
  );
}

function Message({ message }: { readonly message: UIMessage }) {
  const { t } = useTranslation(["assistant", "tools"]);
  if (message.role === "user") {
    return (
      <div className={classes.user}>
        <VisuallyHidden>{t("you")}</VisuallyHidden>
        <p className={classes.bubble}>{textOf(message)}</p>
      </div>
    );
  }
  const interrupted = metadataOf(message).status === "interrupted";
  return (
    <article className={classes.answer} aria-label={t("bot")}>
      <span className={classes.avatar}>
        <Sparkles size={18} strokeWidth={1.8} aria-hidden />
      </span>
      <div className={classes.parts}>
        {message.parts.map((part, index) => (
          <Part key={`${message.id}-${String(index)}`} part={part} />
        ))}
        {interrupted && <p className={classes.muted}>{t("interrupted")}</p>}
      </div>
    </article>
  );
}

/**
 * Часть ответа: текст модели или шаг инструмента. Шаг остаётся в ленте подписью из словаря tools по имени
 * инструмента (CHAT-02: видно, что агент делал) — с вращающимся значком, пока идёт, и галочкой после; результат
 * list_accounts — карточки счетов, ошибка шага — «Шаг не удался».
 */
function Part({ part }: { readonly part: UIMessage["parts"][number] }) {
  const { t } = useTranslation(["assistant", "tools"]);
  if (part.type === "text") return <p className={classes.text}>{part.text}</p>;
  if (!part.type.startsWith("tool-") || !("state" in part)) return null;
  const toolName = part.type.slice("tool-".length);
  const label = toolName === "list_accounts" ? t("tools:list_accounts") : t("tools:fallback");
  const done = part.state === "output-available" || part.state === "output-error";
  const items = part.state === "output-available" ? accountsOf(part.output) : undefined;
  const failed =
    part.state === "output-error" || (part.state === "output-available" && isFailure(part.output));
  return (
    <>
      <p className={classes.step}>
        {done ? (
          <CheckCircle2 size={16} strokeWidth={1.8} aria-hidden />
        ) : (
          <Loader2 className={classes.spin} size={16} strokeWidth={1.8} aria-hidden />
        )}
        {label}
      </p>
      {items !== undefined && (
        <div className={classes.cards}>
          {items.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </div>
      )}
      {failed && <p className={classes.muted}>{t("toolFailed")}</p>}
    </>
  );
}

function textOf(message: UIMessage): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

/** Результат list_accounts — { items: AccountListItem[] } (карточка из @kosht/contract). */
function accountsOf(output: unknown): AccountListItem[] | undefined {
  if (typeof output !== "object" || output === null || !("items" in output)) return undefined;
  const { items } = output;
  return Array.isArray(items) ? (items as AccountListItem[]) : undefined;
}

function isFailure(output: unknown): boolean {
  return typeof output === "object" && output !== null && "ok" in output && output.ok === false;
}
