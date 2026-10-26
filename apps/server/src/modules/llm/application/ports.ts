// Порты llm к внешнему миру сверх провайдеров моделей (ARCHITECTURE §4.4).

/** Удаление трасс пользователя в Langfuse (PRIV-06, OBS-05): сколько трасс отправлено на удаление. */
export interface TraceDeleter {
  deleteUserTraces(userId: string): Promise<number>;
}
