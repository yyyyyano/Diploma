// Порты llm к внешнему миру сверх провайдеров моделей (ARCHITECTURE §4.4).

/** Удаление трасс пользователя в Langfuse (PRIV-06, OBS-05): сколько трасс отправлено на удаление. */
export interface TraceDeleter {
  deleteUserTraces(userId: string): Promise<number>;
  /** Срок хранения трасс (OBS-05): удалить трассы старше момента, пачками ≤ 1000; сколько отправлено на удаление. */
  deleteTracesBefore(before: Date): Promise<number>;
}

/**
 * Эмбеддинги текста (NFR-05, LAW-23): всегда локально — bge-m3 на llama-server, вектор 1024. Модуль, которому нужны
 * векторы (поиск по законам, T-034), зависит от порта, а не от модели; в тестах подставляется хэш-эмбеддер
 * (`@kosht/testing`), и тесты идут без модели.
 */
export interface Embedder {
  /** Длина вектора модели. */
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}
