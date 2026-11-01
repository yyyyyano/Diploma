// Процедуры telegram (contract.telegram.*): тонко — authed (владелец — из сессии) → сценарий привязки. Токен бота и код
// привязки в ответы не попадают: ссылка на бота несёт код, статус показывает только «подключён / ждёт / не настроен».
import { createTelegramT } from "@kosht/i18n";
import { authed } from "../../../platform/http/procedures.ts";
import type { LinkOps } from "../application/link.ts";

export function telegramRouter(ops: LinkOps) {
  const t = createTelegramT();
  return {
    status: authed.telegram.status.handler(({ context }) => ops.status(context.s)),
    beginLink: authed.telegram.beginLink.handler(({ input, context }) =>
      ops.beginLink(context.s, input),
    ),
    cancelLink: authed.telegram.cancelLink.handler(async ({ context }) => {
      await ops.cancelLink(context.s);
      return { ok: true as const };
    }),
    unlink: authed.telegram.unlink.handler(async ({ context }) => {
      await ops.unlink(context.s, t("bot.unlinkedOnSite"));
      return { ok: true as const };
    }),
  };
}
