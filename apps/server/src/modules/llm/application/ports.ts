// Порты llm к внешнему миру сверх провайдеров моделей (ARCHITECTURE §4.4).

/** Удаление трасс пользователя в Langfuse (PRIV-06, OBS-05): сколько трасс отправлено на удаление. */
export interface TraceDeleter {
  deleteUserTraces(userId: string): Promise<number>;
  /** Срок хранения трасс (OBS-05): удалить трассы старше момента, пачками ≤ 1000; сколько отправлено на удаление. */
  deleteTracesBefore(before: Date): Promise<number>;
}
