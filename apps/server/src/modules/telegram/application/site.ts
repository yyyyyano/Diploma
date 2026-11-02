// «Открыть на сайте» (TG-08, NOTIF-05): URL-кнопкой, если Telegram такой адрес примет (публичный), иначе — ссылкой текстом в
// сообщении: `127.0.0.1` и LAN-адреса кнопка отвергает (BUTTON_URL_INVALID), а с телефона без LAN-доступа они и не открываются.
import { isButtonUrl, siteUrl } from "../domain/site-link.ts";
import type { TelegramDeps } from "./deps.ts";
import type { Keyboard } from "./ports.ts";

export interface SiteLink {
  /** Ряд с URL-кнопкой или пусто (адрес для кнопки не годится). */
  readonly row: Keyboard;
  /** Ссылка текстом, которую дописывают к сообщению, если кнопки нет; иначе пусто. */
  readonly suffix: string;
}

export function makeSiteLink(d: Pick<TelegramDeps, "siteOrigin" | "t">) {
  return async function siteLink(path: string): Promise<SiteLink> {
    const url = siteUrl(await d.siteOrigin(), path);
    if (isButtonUrl(url))
      return { row: [[{ text: d.t("bot.buttons.openSite"), url }]], suffix: "" };
    return { row: [], suffix: `\n\n${d.t("bot.notification.siteLink", { url })}` };
  };
}

export type SiteLinkFor = ReturnType<typeof makeSiteLink>;
