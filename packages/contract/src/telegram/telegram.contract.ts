// Telegram-бот (TG-02, PRIV-08): подключение одной кнопкой с сайта. Код привязки в ответе не показывается — он спрятан в
// ссылке на бота (`t.me/<бот>?start=<код>`); пользователь нажимает «Старт», дальше всё делает бот. Владелец — из сессии.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

const Ok = z.strictObject({ ok: z.literal(true) });

export const TelegramStatus = z.strictObject({
  /** Бот настроен: токен задан и процесс `bot` уже узнал имя бота (`getMe`). Нет — кнопка «Подключить» неактивна. */
  configured: z.boolean(),
  botName: z.string().nullable(),
  /** Привязка есть: с какого момента и под каким именем Telegram (`@имя`, если оно задано). */
  linked: z.strictObject({ since: z.iso.datetime(), username: z.string().nullable() }).nullable(),
  /** Ссылка выдана, «Старт» ещё не нажат: до какого момента она действует. */
  pending: z.strictObject({ expiresAt: z.iso.datetime() }).nullable(),
});
export type TelegramStatus = z.infer<typeof TelegramStatus>;

export const telegramContract = {
  status: oc
    .route({ method: "GET", path: "/telegram" })
    .output(TelegramStatus)
    .errors(pickErrors("UNAUTHORIZED")),
  /**
   * «Подключить Telegram»: согласие PRIV-08 (версия текста — `CONSENT_VERSIONS.telegram`) → одноразовый код ≥ 128 бит → ссылка
   * на бота. Бот не настроен — `UNAVAILABLE`; уже подключён — `CONFLICT`; версия текста устарела — `CONFLICT`.
   */
  beginLink: oc
    .route({ method: "POST", path: "/telegram/link" })
    .input(z.strictObject({ version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .output(z.strictObject({ url: z.url(), expiresAt: z.iso.datetime() }))
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "UNAVAILABLE", "CONFLICT")),
  /** «Отмена» до нажатия «Старт»: код гаснет, согласие отзывается. */
  cancelLink: oc
    .route({ method: "POST", path: "/telegram/link/cancel" })
    .output(Ok)
    .errors(pickErrors("UNAUTHORIZED")),
  /** «Отключить»: привязка удаляется, согласие отзывается, бот пишет в чат «аккаунт отключён». */
  unlink: oc
    .route({ method: "POST", path: "/telegram/unlink" })
    .output(Ok)
    .errors(pickErrors("UNAUTHORIZED")),
};
