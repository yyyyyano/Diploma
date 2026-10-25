// Процедуры chat (contract.chat.*): тонко — authed (домохозяйство из сессии) → сценарий. send отдаёт поток кусков
// ответа итератором событий oRPC (streamToEventIterator): поток — подписка на запуск в реестре, поэтому закрытие
// соединения отписывает вкладку, но не останавливает запуск.
import { streamToEventIterator } from "@orpc/server";
import { authed } from "../../../platform/http/procedures.ts";
import type { makeHistory, makeSendMessage, makeStopRun } from "../application/send-message.ts";

export interface ChatUseCases {
  readonly history: ReturnType<typeof makeHistory>;
  readonly send: ReturnType<typeof makeSendMessage>;
  readonly stop: ReturnType<typeof makeStopRun>;
}

export function chatRouter(uc: ChatUseCases) {
  return {
    history: authed.chat.history.handler(({ context }) => uc.history(context.s)),
    send: authed.chat.send.handler(async ({ input, context }) =>
      streamToEventIterator(await uc.send(context.s, input, context.requestId)),
    ),
    stop: authed.chat.stop.handler(({ input, context }) => {
      uc.stop(context.s, input.runId);
      return { ok: true as const };
    }),
  };
}
