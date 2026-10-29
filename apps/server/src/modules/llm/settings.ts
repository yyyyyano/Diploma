// Настройки шлюза (ARCHITECTURE §12): режим кассет и файл кассеты процесса. live — модели цепочки как есть;
// record — то же и запись шагов в кассету; replay — ответы из кассеты без сети (стенд e2e). Тесты сценариев задают
// режим своим шлюзом (cassetteMode из @kosht/testing), а не этими настройками.
import { z } from "zod";
import { defineSecret } from "../../platform/secrets/secrets.ts";
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

/** Ключи облачных провайдеров (ADM-50, NFR-16): админка важнее переменной окружения; наружу — «задан / не задан». */
export const GROQ_API_KEY = defineSecret({ name: "llm.groq-api-key", env: "GROQ_API_KEY" });
export const ZAI_API_KEY = defineSecret({ name: "llm.zai-api-key", env: "ZAI_API_KEY" });

/** Сколько ждать первого куска ответа облачной модели, мс: дольше — цепочка идёт к следующей (LLM-03). */
export const LLM_TIMEOUT_CLOUD_MS = defineSetting({
  key: "llm.timeout-cloud-ms",
  schema: z.int().min(1000).max(600_000),
  default: 30_000,
  env: "LLM_TIMEOUT_CLOUD_MS",
  fromEnv: Number,
});

/** То же для локальной модели: на процессоре без видеокарты ответ идёт минутами (ADR-0011), поэтому срок длиннее. */
export const LLM_TIMEOUT_LOCAL_MS = defineSetting({
  key: "llm.timeout-local-ms",
  schema: z.int().min(1000).max(1_800_000),
  default: 300_000,
  env: "LLM_TIMEOUT_LOCAL_MS",
  fromEnv: Number,
});

/** Адрес llama-server (OpenAI-совместимый API): в make dev — порт на этом компьютере, в контейнерах — сервис llama. */
export const LLM_LLAMA_BASE_URL = defineSetting({
  key: "llm.llama-base-url",
  schema: z.url({ protocol: /^https?$/ }).max(512),
  default: "http://127.0.0.1:8142/v1",
  env: "LLAMA_BASE_URL",
});

/**
 * Скачивать ли локальные модели (NFR-25): по умолчанию да — после первого запуска и кнопкой в админке. Тесты и стенд
 * e2e выключают (LLM_MODELS_DOWNLOAD=0): гигабайты из интернета в тестах недопустимы (NFR-11).
 */
export const LLM_MODELS_DOWNLOAD = defineSetting({
  key: "llm.models-download",
  schema: z.boolean(),
  default: true,
  env: "LLM_MODELS_DOWNLOAD",
  fromEnv: (raw) => raw === "1" || raw === "true",
});

/** Сколько дней хранится журнал расхода (LLM-06): старше — удаляет ночная задача llm.usage-retention. */
export const LLM_USAGE_RETENTION_DAYS = defineSetting({
  key: "llm.usage-retention-days",
  schema: z.int().min(1).max(3650),
  default: 90,
  env: "LLM_USAGE_RETENTION_DAYS",
  fromEnv: Number,
});

/** Сколько дней хранятся трассы Langfuse (OBS-05): старше — удаляет ночная задача llm.trace-retention. */
export const LLM_TRACE_RETENTION_DAYS = defineSetting({
  key: "llm.trace-retention-days",
  schema: z.int().min(1).max(3650),
  default: 30,
  env: "LLM_TRACE_RETENTION_DAYS",
  fromEnv: Number,
});
