// Отправка без опроса (TG-06, TG-03): воркер и api шлют сообщения через `Api` grammY — опрос не нужен, замок не берётся
// (отправлять могут все процессы). `Api` пересобирается, когда в админке сменили токен.
import { autoRetry } from "@grammyjs/auto-retry";
import { Api } from "grammy";
import type { Logger } from "../../../../platform/logging/logger.ts";
import type { Secrets } from "../../../../platform/secrets/secrets.ts";
import type { Sender } from "../../application/ports.ts";
import { TELEGRAM_TOKEN } from "../../settings.ts";
import { createBotApi } from "./grammy-api.ts";

export function createSenderProvider(d: {
  readonly secrets: Pick<Secrets, "reveal">;
  readonly log: Logger;
}): () => Promise<Sender | undefined> {
  let cached: { readonly token: string; readonly sender: Sender } | undefined;
  return async () => {
    const token = await d.secrets.reveal(TELEGRAM_TOKEN);
    if (token === undefined) return undefined;
    if (cached?.token === token) return cached.sender;
    const api = new Api(token);
    api.config.use(autoRetry());
    const sender = createBotApi({ api, token, log: d.log });
    cached = { token, sender };
    return sender;
  };
}
