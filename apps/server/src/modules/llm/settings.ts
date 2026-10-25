// Настройки шлюза (ARCHITECTURE §12): режим кассет и файл кассеты процесса. live — модели цепочки как есть;
// record — то же и запись шагов в кассету; replay — ответы из кассеты без сети (стенд e2e). Тесты сценариев задают
// режим своим шлюзом (cassetteMode из @kosht/testing), а не этими настройками.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";
import { CASSETTE_MODES, type CassetteMode } from "./infrastructure/providers/cassettes.ts";

export const LLM_MODE = defineSetting({
  key: "llm.mode",
  schema: z.enum(CASSETTE_MODES),
  default: "live" as CassetteMode,
  env: "LLM_MODE",
});

/** Путь к файлу кассеты для record и replay; пусто — кассеты нет. */
export const LLM_CASSETTE = defineSetting({
  key: "llm.cassette",
  schema: z.string().max(1024),
  default: "",
  env: "LLM_CASSETTE",
});

/** Повторять паузы записи кассеты (e2e — да: виден поток); тесты сценариев выключают — быстрее. */
export const LLM_CASSETTE_DELAYS = defineSetting({
  key: "llm.cassette-delays",
  schema: z.boolean(),
  default: true,
  env: "LLM_CASSETTE_DELAYS",
  fromEnv: (raw) => raw === "1" || raw === "true",
});
