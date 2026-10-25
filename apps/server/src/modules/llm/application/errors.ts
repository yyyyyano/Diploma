// Ошибки шлюза вне каталога @kosht/contract (наружу — INTERNAL без текста, toErrorBody): это баги кода, а не
// состояния, о которых говорят пользователю.

/** Модель позвали внутри s.transaction (ARCHITECTURE §4.3): соединение пула держалось бы на время ответа модели. */
export class LlmInTransactionError extends Error {
  readonly code = "LLM_IN_TRANSACTION";
  override readonly name = "LlmInTransactionError";
  constructor() {
    super(
      "Вызов модели внутри s.transaction: позовите модель до или после транзакции (ARCHITECTURE §4.3).",
    );
  }
}

/** Ответ модели не прошёл схему и после повтора (LLM-04). */
export class LlmSchemaError extends Error {
  readonly code = "LLM_SCHEMA";
  override readonly name = "LlmSchemaError";
}
