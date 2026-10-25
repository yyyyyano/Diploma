// «Ассистент» (CHAT-02): лента диалога с потоком ответа. Страница — features/assistant.
import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { AssistantPage } from "../../features/assistant/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/assistant")({
  staticData: {
    page: "assistant",
    nav: { group: "main", order: 20, section: "assistant", icon: MessageCircle, phoneOrder: 3 },
  },
  // prefetch, а не ensure: ошибку загрузки истории показывает сама страница.
  loader: ({ context }) => context.queryClient.prefetchQuery(orpc.chat.history.queryOptions()),
  component: AssistantPage,
});
