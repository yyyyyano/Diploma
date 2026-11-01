// Загрузка диалога для ChatView (CHAT-01): сообщения — запросом `chat.history` по id, новый диалог (null) — пустой,
// без запроса. Обновления по сигналу chat-message приходят тем же запросом: `serverMessages` меняется, ChatView их
// подхватывает (ответ, который сервер дописал без этой вкладки). Диалог меняется заменой `key` у родителя.
import type { ChatMessage, ConversationId, PageContext } from "@kosht/contract";
import { Button } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { EmptyState, SkeletonText } from "../../ui/index.ts";
import { ChatView } from "./ChatView.tsx";

/** Один и тот же пустой список: новый массив на каждый рендер заставил бы ChatView стирать переписку (эффект по ссылке). */
const NO_MESSAGES: readonly ChatMessage[] = [];

export interface ChatLoaderProps {
  readonly variant: "page" | "panel";
  readonly conversationId: ConversationId | null;
  readonly getPage: () => PageContext | undefined;
  readonly onConversation: (id: ConversationId) => void;
  readonly userName?: string | undefined;
}

export function ChatLoader({ conversationId, ...rest }: ChatLoaderProps) {
  const { t } = useTranslation("assistant");
  const history = useQuery({
    ...orpc.chat.history.queryOptions({ input: { conversationId: conversationId ?? undefined } }),
    enabled: conversationId !== null,
  });
  if (conversationId === null) {
    return <ChatView conversationId={null} serverMessages={NO_MESSAGES} {...rest} />;
  }
  if (history.isError) {
    return (
      <EmptyState
        tone="error"
        icon={TriangleAlert}
        title={t("historyError.title")}
        description={t("historyError.text")}
        actions={<Button onClick={() => void history.refetch()}>{t("historyError.retry")}</Button>}
      />
    );
  }
  if (!history.isSuccess) return <SkeletonText lines={4} />;
  return (
    <ChatView conversationId={conversationId} serverMessages={history.data.messages} {...rest} />
  );
}
