// Боковая панель «Спросить ассистента» (CHAT-08, design: Main--assistant-panel): открывается с любой страницы справа и
// видит её — «Вижу: Главная · Октябрь 2026»; тот же чат, что на странице (ChatView), диалог — последний. Панель
// остаётся смонтированной после закрытия: идущий ответ не теряется, а при следующем открытии виден как был.
// Лениво: чат, Markdown и AI SDK не входят в первую загрузку сайта.
import type { ConversationId } from "@kosht/contract";
import { Button, Drawer } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { Eye, MessageSquarePlus, Sparkles, TriangleAlert } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, SkeletonText } from "../../ui/index.ts";
import classes from "./AssistantPanel.module.css";
import { ChatLoader } from "./ChatLoader.tsx";
import { useInitialConversation } from "./model/use-initial-conversation.ts";
import { useSeen } from "./model/use-seen.ts";

export interface AssistantPanelProps {
  readonly opened: boolean;
  readonly onClose: () => void;
}

export function AssistantPanel({ opened, onClose }: AssistantPanelProps) {
  const { t } = useTranslation("assistant");
  const seen = useSeen();
  const initial = useInitialConversation();
  const navigate = useNavigate();
  const [target, setTarget] = useState<{
    readonly key: number;
    readonly id: ConversationId | null;
  }>({ key: 0, id: null });
  const [active, setActive] = useState<ConversationId | null>(null);
  // Диалог по умолчанию — последний; выбирается один раз, когда список пришёл.
  const [resolved, setResolved] = useState(false);
  if (initial.status === "ready" && !resolved) {
    setResolved(true);
    setTarget({ key: 0, id: initial.id });
    setActive(initial.id);
  }

  const start = useCallback(() => {
    setTarget((current) => ({ key: current.key + 1, id: null }));
    setActive(null);
  }, []);
  const openChat = () => {
    onClose();
    void navigate({ to: "/assistant", search: active === null ? {} : { c: active } });
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={460}
      keepMounted
      closeButtonProps={{ "aria-label": t("panel.close") }}
      classNames={{
        overlay: classes.overlay,
        content: classes.content,
        header: classes.header,
        body: classes.body,
      }}
      title={
        <div className={classes.title}>
          <span className={classes.avatar}>
            <Sparkles size={18} strokeWidth={1.8} aria-hidden />
          </span>
          <div className={classes.titleText}>
            <span className={classes.name}>{t("panel.title")}</span>
            <span className={classes.seen}>
              <Eye size={14} strokeWidth={1.8} aria-hidden />
              {t("panel.sees", { page: seen.label })}
            </span>
          </div>
        </div>
      }
    >
      <div className={classes.bar}>
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<MessageSquarePlus size={16} strokeWidth={1.8} aria-hidden />}
          onClick={start}
        >
          {t("panel.newDialog")}
        </Button>
        <Button variant="subtle" size="compact-sm" onClick={openChat}>
          {t("panel.open")}
        </Button>
      </div>
      {initial.status === "error" && (
        <EmptyState
          tone="error"
          icon={TriangleAlert}
          title={t("historyError.title")}
          description={t("historyError.text")}
          actions={<Button onClick={initial.retry}>{t("historyError.retry")}</Button>}
        />
      )}
      {initial.status === "pending" && <SkeletonText lines={4} />}
      {resolved && (
        <ChatLoader
          key={target.key}
          variant="panel"
          conversationId={target.id}
          getPage={() => seen.context}
          onConversation={setActive}
        />
      )}
    </Drawer>
  );
}
