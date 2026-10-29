// Задачи шлюза и возможности моделей (LLM-01, LLM-09, ADR-0009): модель не зашивается в код — задача называет нужные
// возможности, цепочку собирают записи реестра, у которых они есть. Новая задача — строка здесь (и умолчание цепочки
// в реестре моделей).

/** Что умеет модель (поле capabilities записи реестра). */
export const CAPABILITIES = [
  "text",
  "tools",
  "images",
  "structured",
  "speech",
  "embeddings",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Задачи и их возможности: чат агента — инструменты и поток, извлечение — ответ по схеме, речь, векторы. */
export const TASKS = {
  chat: ["text", "tools"],
  "receipt.extract": ["images", "structured"],
  "statement.scan": ["images", "structured"],
  "statement.columns": ["structured"],
  "classify.category": ["structured"],
  "classify.off-topic": ["structured"],
  "law.topic": ["structured"],
  embed: ["embeddings"],
  transcribe: ["speech"],
} as const satisfies Record<string, readonly Capability[]>;

export type LlmTask = keyof typeof TASKS;
/** Задачи извлечения и классификации — ответ строго по схеме (LLM-04). */
export type StructuredTask =
  | "receipt.extract"
  | "statement.scan"
  | "statement.columns"
  | "classify.category"
  | "classify.off-topic"
  | "law.topic";

/** Эмбеддинги — только локально, при любом согласии (NFR-05). */
export const LOCAL_ONLY_TASKS: ReadonlySet<LlmTask> = new Set(["embed"]);
