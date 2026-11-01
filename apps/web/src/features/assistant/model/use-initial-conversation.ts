// Какой диалог открыть первым (CHAT-01): указанный в адресе, иначе последний по времени сообщения — первый в списке.
// Выбор делается один раз, когда список пришёл: дальше экран ведёт открытый диалог сам, и новый ответ в другом
// диалоге (например, из панели) не подменяет тот, что читает человек. Список берётся из кэша, если его уже прогрел
// loader маршрута (`fetchQuery` не ходит в сеть за свежими данными).
import type { ConversationId } from "@kosht/contract";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { orpc } from "../../../lib/api.ts";

export type InitialConversation =
  | { readonly status: "pending" }
  | { readonly status: "error"; readonly retry: () => void }
  | { readonly status: "ready"; readonly id: ConversationId | null };

export function useInitialConversation(fromUrl?: ConversationId): InitialConversation {
  const queryClient = useQueryClient();
  const [state, setState] = useState<InitialConversation>(
    fromUrl === undefined ? { status: "pending" } : { status: "ready", id: fromUrl },
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (fromUrl !== undefined) return;
    let cancelled = false;
    // Состояние ставится из ответа сети, а не синхронно в эффекте.
    queryClient.fetchQuery(orpc.chat.conversations.queryOptions()).then(
      (list) => {
        if (!cancelled) setState({ status: "ready", id: list.items[0]?.id ?? null });
      },
      () => {
        if (cancelled) return;
        setState({
          status: "error",
          retry: () => {
            setState({ status: "pending" });
            setAttempt((count) => count + 1);
          },
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fromUrl, queryClient, attempt]);
  return state;
}
