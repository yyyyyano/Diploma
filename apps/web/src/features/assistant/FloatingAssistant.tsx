// Плавающая кнопка «Спросить ассистента» (CHAT-08): на любой странице раздела пользователя открывает панель справа;
// на телефоне панели нет — открывается полноэкранная страница чата (MobileChat). Это обычная кнопка в первой загрузке,
// а панель с чатом — ленивый чанк, который грузится при первом нажатии. Просьба из другого места сайта
// (`lib/assistant-bridge`, «Спросить ассистента об этой статье») открывает то же самое, вопрос ложится в поле ввода.
import { ActionIcon } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useNavigate } from "@tanstack/react-router";
import { MessageCircleQuestionMark } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assistantBridge } from "../../lib/assistant-bridge.ts";
import { usePageInfo } from "../../lib/page-context.ts";
import classes from "./FloatingAssistant.module.css";
import { useSeen } from "./model/use-seen.ts";

const AssistantPanel = lazy(() =>
  import("./AssistantPanel.tsx").then((module) => ({ default: module.AssistantPanel })),
);

const PHONE_QUERY = "(max-width: 760px)";

export function FloatingAssistant() {
  const { t } = useTranslation("assistant");
  const navigate = useNavigate();
  const isPhone = useMediaQuery(PHONE_QUERY) === true;
  const { page } = usePageInfo();
  // Запоминает страницу для чата (на телефоне он откроется уже на другой странице).
  useSeen();
  const [opened, setOpened] = useState(false);
  const [mounted, setMounted] = useState(false);
  const open = () => {
    if (isPhone) void navigate({ to: "/assistant" });
    else {
      setMounted(true);
      setOpened(true);
    }
  };

  // Просьба из моста («Спросить ассистента об этой статье») — та же кнопка: слушаем мост, а не гоняем состояние эффектом.
  const latest = useRef({ open, onChat: page === "assistant" });
  useEffect(() => {
    latest.current = { open, onChat: page === "assistant" };
  });
  useEffect(() => {
    let handled = assistantBridge.getState().openRequest;
    return assistantBridge.subscribe(() => {
      const request = assistantBridge.getState().openRequest;
      if (request === handled) return;
      handled = request;
      // На странице чата вопрос подхватит сам чат: панель не нужна.
      if (!latest.current.onChat) latest.current.open();
    });
  }, []);

  if (page === "assistant") return null;
  return (
    <>
      <ActionIcon
        className={classes.fab}
        size={56}
        radius="xl"
        aria-label={t("panel.button")}
        title={t("panel.button")}
        onClick={open}
      >
        <MessageCircleQuestionMark size={26} strokeWidth={1.8} aria-hidden />
      </ActionIcon>
      {mounted && (
        <Suspense fallback={null}>
          <AssistantPanel opened={opened} onClose={() => setOpened(false)} />
        </Suspense>
      )}
    </>
  );
}
