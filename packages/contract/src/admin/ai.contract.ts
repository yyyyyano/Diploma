// «Провайдеры ИИ» (ADM-50, LLM-08, LLM-09) и «Запросы к ИИ» (ADM-20, ADM-21) админки: цепочки по задачам, реестр
// моделей, проверка связи, ключи только для записи, цифры из журнала расхода. Ответы — метаданные и числа (PRIV-07,
// ADM-22): ни текстов запросов и ответов, ни пользователей, ни значений ключей (наружу — «задан / не задан»).
// Цифры считает сервер; сайт их только форматирует. Состав задач и возможностей сверяет llm/domain/tasks.test.ts.
import { z } from "zod";

/** Задачи шлюза (llm/domain/tasks.ts): для каждой — своя цепочка моделей. */
export const AI_TASKS = [
  "chat",
  "receipt.extract",
  "statement.scan",
  "statement.columns",
  "classify.category",
  "classify.off-topic",
  "law.topic",
  "weekly.summary",
  "embed",
  "transcribe",
] as const;
export const AiTask = z.enum(AI_TASKS);
export type AiTask = z.infer<typeof AiTask>;

/** Возможности модели (llm/domain/tasks.ts). */
export const AI_CAPABILITIES = [
  "text",
  "tools",
  "images",
  "structured",
  "speech",
  "embeddings",
] as const;
export const AiCapability = z.enum(AI_CAPABILITIES);
export type AiCapability = z.infer<typeof AiCapability>;

const Count = z.int().min(0);
/** Лимит тарифа; null — не опубликован. */
const Limit = z.int().min(1).nullable();

export const AiLimits = z.strictObject({ rpm: Limit, tpm: Limit, rpd: Limit, tpd: Limit });

/** Запись реестра моделей (LLM-09). Облачная ли — решает провайдер, а не администратор (PRIV-02). */
export const AiModel = z.strictObject({
  /** `<провайдер>/<модель>`. */
  id: z.string().min(1).max(200),
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(200),
  cloud: z.boolean(),
  capabilities: z.array(AiCapability).max(AI_CAPABILITIES.length),
  priority: z.int().min(0).max(10_000),
  enabled: z.boolean(),
  /** Пользователям разрешено выбирать эту модель в чате (LLM-10). */
  userSelectable: z.boolean(),
  contextTokens: Count,
  /** Условная стоимость: микродолларов за миллион токенов (NFR-02: по умолчанию 0). */
  inputMicrosPerMillion: Count,
  outputMicrosPerMillion: Count,
  limits: AiLimits,
});
export type AiModel = z.infer<typeof AiModel>;

/** Провайдер: ключ API — «задан / не задан / не читается» (значение наружу не отдаётся, NFR-16); `none` — ключа нет. */
export const AiProvider = z.strictObject({
  id: z.string().min(1).max(64),
  cloud: z.boolean(),
  key: z.enum(["set", "unset", "unreadable", "none"]),
});
export type AiProvider = z.infer<typeof AiProvider>;

/** Порядок цепочки задачи (id моделей); `custom: false` — строк нет, порядок по приоритету записей. */
export const AiTaskChain = z.strictObject({
  task: AiTask,
  custom: z.boolean(),
  models: z.array(z.string().max(200)).max(50),
});

export const AiProviders = z.strictObject({
  providers: z.array(AiProvider).max(20),
  models: z.array(AiModel).max(500),
  chains: z.array(AiTaskChain).max(AI_TASKS.length),
});
export type AiProviders = z.infer<typeof AiProviders>;

/** Итог «Проверить связь»: `GET /models` провайдера и наличие модели в списке (LLM-08). */
export const AiConnectionResult = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), ms: Count }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(["no-key", "unauthorized", "unreachable", "model-missing", "unsupported"]),
  }),
]);
export type AiConnectionResult = z.infer<typeof AiConnectionResult>;

export const SetAiChainInput = z.strictObject({
  task: AiTask,
  models: z.array(z.string().min(1).max(200)).min(1).max(50),
});

export const SetAiModelEnabledInput = z.strictObject({
  id: z.string().min(1).max(200),
  enabled: z.boolean(),
});

/** Добавить модель существующего провайдера или изменить запись (по `provider/model`). */
export const SaveAiModelInput = z.strictObject({
  provider: z.string().min(1).max(64),
  model: z.string().trim().min(1).max(200),
  capabilities: z.array(AiCapability).min(1).max(AI_CAPABILITIES.length),
  priority: z.int().min(0).max(10_000),
  userSelectable: z.boolean(),
  contextTokens: Count,
  inputMicrosPerMillion: Count,
  outputMicrosPerMillion: Count,
  limits: AiLimits,
});

export type SaveAiModelInput = z.infer<typeof SaveAiModelInput>;

/** Ключ провайдера: поле только для записи; null — убрать ключ из админки (останется .env, если задан). */
export const SetAiKeyInput = z.strictObject({
  provider: z.enum(["groq", "zai"]),
  key: z.string().min(1).max(4096).nullable(),
});

export const SetAiPriceInput = z.strictObject({
  id: z.string().min(1).max(200),
  inputMicrosPerMillion: Count,
  outputMicrosPerMillion: Count,
});

/** Состояние файла и модели при скачивании (NFR-25): нет, ждёт, скачивается, проверяется, готово, ошибка. */
export const LocalModelState = z.enum([
  "absent",
  "pending",
  "downloading",
  "verifying",
  "ready",
  "failed",
]);
export type LocalModelState = z.infer<typeof LocalModelState>;

/**
 * Общее состояние набора: «скачивается» — только живая загрузка; `pending` — докачка прервана (worker умер, abort),
 * её никто не ведёт и её можно продолжить. Код ошибки — машинный (`HTTP_404`, `NO_SPACE`…), текст подставляет сайт. */
const LocalModelsTotals = {
  state: z.enum(["absent", "pending", "downloading", "ready", "failed"]),
  bytesDone: Count,
  bytesTotal: Count,
};

/** Прогресс скачивания для экрана первого запуска: без списка файлов, опрос раз в 2 с (NFR-25). */
export const LocalModelsProgress = z.strictObject(LocalModelsTotals);
export type LocalModelsProgress = z.infer<typeof LocalModelsProgress>;

/** Локальные модели в админке (ADM-50, NFR-25): модели каталога с файлами, прогресс и итог самотеста. */
export const LocalModelsOverview = z.strictObject({
  ...LocalModelsTotals,
  models: z
    .array(
      z.strictObject({
        id: z.string().max(64),
        kind: z.enum(["chat", "embedding", "speech", "ner"]),
        state: LocalModelState,
        bytesDone: Count,
        bytesTotal: Count,
        errorCode: z.string().max(40).nullable(),
        files: z
          .array(
            z.strictObject({
              path: z.string().max(200),
              size: Count,
              state: LocalModelState,
              bytesDone: Count,
              errorCode: z.string().max(40).nullable(),
            }),
          )
          .max(20),
      }),
    )
    .max(20),
  /** Самотест при старте: unknown — не запускался; down — сервис моделей не запущен; ok; failed. */
  selfTest: z.strictObject({
    state: z.enum(["unknown", "ok", "down", "failed"]),
    problem: z.string().max(40).nullable(),
    /** Запасной режим «всё на процессоре» после «мусора» на видеоядре. */
    cpuFallback: z.boolean(),
  }),
});
export type LocalModelsOverview = z.infer<typeof LocalModelsOverview>;

/** Периоды «Запросов к ИИ»: скользящие сутки, 7 и 30 суток. */
export const AiPeriod = z.enum(["day", "week", "month"]);
export type AiPeriod = z.infer<typeof AiPeriod>;

const Used = z.strictObject({ used: Count, limit: Limit });

/** «Запросы к ИИ» (ADM-20): основные цифры журнала расхода за период; текстов нет (ADM-22). */
export const AiUsage = z.strictObject({
  period: AiPeriod,
  totals: z.strictObject({
    requests: Count,
    tokens: Count,
    /** Условная стоимость, микродолларов (по прайсу записей реестра, ADM-21). */
    costMicros: Count,
    /** Медиана времени ответа, мс; вызовов нет — null. */
    medianMs: Count.nullable(),
    errors: Count,
    /** Доля ошибок в промилле (1,4 % = 14); вызовов нет — 0. */
    errorPermille: z.int().min(0).max(1000),
  }),
  byTask: z
    .array(z.strictObject({ task: z.string().max(64), requests: Count, tokens: Count }))
    .max(50),
  byProvider: z
    .array(
      z.strictObject({
        provider: z.string().max(64),
        cloud: z.boolean(),
        requests: Count,
        tokens: Count,
        errors: Count,
      }),
    )
    .max(50),
  /** Ответов облачных и локальных моделей — «кто отвечал». */
  cloudRequests: Count,
  localRequests: Count,
  /** Расход дневных лимитов (скользящие сутки) у моделей, для которых лимит опубликован или расход есть. */
  dailyLimits: z
    .array(
      z.strictObject({
        id: z.string().max(200),
        provider: z.string().max(64),
        requests: Used,
        tokens: Used,
      }),
    )
    .max(500),
  prices: z
    .array(
      z.strictObject({
        id: z.string().max(200),
        provider: z.string().max(64),
        model: z.string().max(200),
        inputMicrosPerMillion: Count,
        outputMicrosPerMillion: Count,
      }),
    )
    .max(500),
  /** Подробные трассы — в Langfuse (OBS-05): адрес интерфейса на этом компьютере; выключен — null. */
  langfuseUrl: z.string().nullable(),
});
export type AiUsage = z.infer<typeof AiUsage>;
