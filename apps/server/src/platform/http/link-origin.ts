// Адрес ссылок в письмах (NFR-24) — только из настроек, никогда из запроса: доступ из сети включён и адрес задан —
// настройка network.lan-address (поле — в админке; включить доступ без адреса нельзя, system.setLan), иначе — адрес
// локального входа. Заголовок Host запроса не участвует: его задаёт клиент, и на сетевом входе любой в сети подставил
// бы свой IP — ссылка сброса в настоящем письме увела бы токен к нему (подмена Host, OWASP). Сетевой адрес не берётся
// и из os.networkInterfaces(): в контейнере он 172.x и снаружи недоступен.
import { z } from "zod";
import { defineSetting, type Settings } from "../settings/settings.ts";
import { ALLOW_LAN } from "./allow-lan.ts";

/** Адрес сайта в локальной сети (`http://192.168.1.5:8141`); пусто — не задан. Без env: только из админки. */
export const LAN_ADDRESS = defineSetting({
  key: "network.lan-address",
  schema: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
  default: "",
});

export interface LinkOriginOptions {
  readonly allowLan: boolean;
  readonly lanAddress: string;
  readonly localOrigin: string;
}

/** Начало ссылки (`http://хост:порт`) для письма. */
export function linkOrigin(options: LinkOriginOptions): string {
  if (options.allowLan && options.lanAddress !== "") return new URL(options.lanAddress).origin;
  return options.localOrigin;
}

/** То же с настройками процесса (кэш настроек ≤ 5 с). */
export async function resolveLinkOrigin(
  settings: Pick<Settings, "get">,
  localOrigin: string,
): Promise<string> {
  return linkOrigin({
    allowLan: await settings.get(ALLOW_LAN),
    lanAddress: await settings.get(LAN_ADDRESS),
    localOrigin,
  });
}
