// Флаг «идёт транзакция ScopedDb» (ARCHITECTURE §4.3, ADR-0009): модель, HTTP и чтение файлов — только между
// транзакциями, иначе соединение пула держится на время ответа модели (секунды). Шлюз llm спрашивает флаг перед
// каждым вызовом и бросает LLM_IN_TRANSACTION. В AsyncLocalStorage — только булево, данных там нет.
import { AsyncLocalStorage } from "node:async_hooks";

const flag = new AsyncLocalStorage<true>();

/** Код выполняется внутри s.transaction (в том числе вложенной). */
export function inTransaction(): boolean {
  return flag.getStore() === true;
}

/** Выполнить fn с поднятым флагом: так его видит любой код, вызванный из тела транзакции. */
export function withTransactionFlag<R>(fn: () => Promise<R>): Promise<R> {
  return flag.run(true, fn);
}
