// «Ассистент» (CHAT-01, CHAT-02): диалоги и лента с потоком ответа. Открытый диалог — `?c=`; страница — features/assistant.
import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { AssistantPage, AssistantSearch } from "../../features/assistant/index.ts";
import { orpc } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/assistant")({
  validateSearch: AssistantSearch,
  staticData: {
    page: "assistant",
    nav: { group: "main", order: 20, section: "assistant", icon: MessageCircle, phoneOrder: 3 },
  },
  // prefetch, а не ensure: ошибку загрузки списка показывает сама страница.
  loader: ({ context }) =>
    context.queryClient.prefetchQuery(orpc.chat.conversations.queryOptions()),
  component: () => <AssistantPage search={Route.useSearch()} />,
});
