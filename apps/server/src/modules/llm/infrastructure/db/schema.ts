// Таблицы llm (LLM-06, LLM-09, ARCHITECTURE §8.1): реестр моделей и журнал расхода — systemTable модуля.
// В журнале — только служебное: задача, провайдер, модель, токены, длительность, стоимость, код ошибки. Ни текстов
// запросов и ответов, ни пользователя (OBS-04): лимиты считаются по провайдеру и модели.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { systemTable, userOwnedTable } from "../../../../platform/db/tables.ts";

/** Реестр моделей (LLM-09): модель — запись, а не строка в коде; новая модель — строка в админке (T-023). */
export const llmModels = systemTable("llm_models", {
  /** `<провайдер>/<модель>`. */
  id: text().primaryKey(),
  provider: text().notNull(),
  modelId: text().notNull(),
  /** Облачная: данные уходят за пределы компьютера — только с согласием (PRIV-02). */
  cloud: boolean().notNull(),
  /** Возможности: text, tools, images, structured, speech, embeddings (llm/domain/tasks.ts). */
  capabilities: text().array().notNull(),
  /** Меньше — раньше в цепочке. */
  priority: integer().notNull().default(100),
  enabled: boolean().notNull().default(true),
  contextTokens: integer().notNull(),
  /** Цены условной стоимости: микродолларов за миллион токенов. */
  inputMicrosPerMillion: integer().notNull().default(0),
  outputMicrosPerMillion: integer().notNull().default(0),
  /** Лимиты бесплатного тарифа (LLM-05, LLM-09): запросов и токенов в минуту и в сутки; null — лимит не опубликован. */
  rpm: integer(),
  tpm: integer(),
  rpd: integer(),
  tpd: integer(),
  /** Администратор разрешил пользователям выбирать эту модель в чате (LLM-10). */
  userSelectable: boolean().notNull().default(false),
});

/**
 * Порядок цепочки по задаче (LLM-02, ADM-50): модели задачи по возрастанию position. У задачи без строк порядок —
 * по priority записей реестра. Без внешнего ключа на llm_models: модель удалена — строка просто не находит запись.
 */
export const llmTaskChains = systemTable(
  "llm_task_chains",
  {
    task: text().notNull(),
    modelId: text().notNull(),
    position: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.task, t.modelId] })],
);

/** Выбор модели пользователем в чате (LLM-10): одна строка на пользователя; «Авто» — строки нет. */
export const llmPreferences = userOwnedTable(
  "llm_preferences",
  {
    modelId: text().notNull(),
  },
  (t) => [uniqueIndex("llm_preferences_user_idx").on(t.householdId, t.userId)],
);

/** Журнал расхода (LLM-06): строка на каждый вызов модели. */
export const llmUsage = systemTable(
  "llm_usage",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    task: text().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    ms: integer().notNull(),
    costMicros: bigint({ mode: "number" }).notNull(),
    /** Код ошибки вызова (без текста) или null. */
    errorCode: text(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index("llm_usage_created_at_idx").on(t.createdAt)],
);

/**
 * Очередь повторов удаления трасс Langfuse (PRIV-06, OBS-05): аккаунт удалён, а Langfuse был недоступен — строка ждёт
 * ежедневного повтора. Без домохозяйства и scope: пользователя уже нет, остался только его id (по нему Langfuse
 * находит трассы). Удаление аккаунта этой очередью не блокируется.
 */
export const llmTraceDeletions = systemTable("llm_trace_deletions", {
  userId: uuid().primaryKey(),
  attempts: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull(),
  lastAttemptAt: timestamp({ withTimezone: true }),
});
