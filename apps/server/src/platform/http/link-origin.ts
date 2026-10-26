// Адрес ссылок в письмах (NFR-24): запрос пришёл на сетевой слушатель — адрес из его Host (уже проверен
// isAllowedHost в app.ts: на lan это localhost или IP); иначе при включённом доступе из сети — настройка
// network.lan-address (поле — в админке, T-017); иначе — адрес локального входа. Сетевой адрес не берётся из
// os.networkInterfaces(): в контейнере он 172.x и снаружи недоступен.
import { z } from "zod";
import { defineSetting, type Settings } from "../settings/settings.ts";
import { ALLOW_LAN } from "./allow-lan.ts";
import type { ListenerName } from "./guard.ts";

/** Адрес сайта в локальной сети (`http://192.168.1.5:8141`); пусто — не задан. Без env: только из админки. */
export const LAN_ADDRESS = defineSetting({
  key: "network.lan-address",
  schema: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
  default: "",
});

/** Откуда пришёл запрос: слушатель и заголовок Host. */
export interface LinkRequest {
  readonly listener: ListenerName;
  readonly host: string | undefined;
}

export interface LinkOriginOptions {
  readonly allowLan: boolean;
  readonly lanAddress: string;
  readonly localOrigin: string;
}

/** Начало ссылки (`http://хост:порт`) для письма по запросу. */
export function linkOrigin(request: LinkRequest, options: LinkOriginOptions): string {
  if (request.listener === "lan" && request.host !== undefined && request.host !== "") {
    return `http://${request.host}`;
  }
  if (options.allowLan && options.lanAddress !== "") return new URL(options.lanAddress).origin;
  return options.localOrigin;
}

/** То же с настройками процесса (кэш настроек ≤ 5 с). */
export async function resolveLinkOrigin(
  settings: Pick<Settings, "get">,
  localOrigin: string,
  request: LinkRequest,
): Promise<string> {
  return linkOrigin(request, {
    allowLan: await settings.get(ALLOW_LAN),
    lanAddress: await settings.get(LAN_ADDRESS),
    localOrigin,
  });
}
