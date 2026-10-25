// Настройка «Разрешить доступ с других устройств в локальной сети» (NFR-24, ADM-60): по умолчанию выключена, только
// из админки — переменной окружения у неё нет: сетевой вход не должен открываться правкой .env мимо админки.
// Слушатель lan сверяется с ней каждую секунду (listeners.ts).
import { z } from "zod";
import { defineSetting } from "../settings/settings.ts";

export const ALLOW_LAN = defineSetting({
  key: "network.allow-lan",
  schema: z.boolean(),
  default: false,
});
