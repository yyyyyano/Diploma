// Очередь задач для тестов сценариев (ARCHITECTURE §4.4): выполняет задачу сразу, в той же транзакции, вместо
// pg-boss. Порт Jobs объявлен на сервере, а пакет тестов сервер не импортирует, поэтому обработчик по имени задачи
// находит функция теста, а совпадение формы с портом проверяет присваивание в
// apps/server/src/platform/jobs/inline-jobs.test.ts (как у MemoryBlobStore).

/** Задача, как её видит InlineJobs: достаточно имени очереди. */
export interface InlineJob {
  readonly name: string;
}

/** Выполнить задачу сразу: tx — транзакция, в которой её поставили. */
export type InlineHandler<Tx> = (tx: Tx, payload: unknown) => Promise<void>;

export class InlineJobs<Tx> {
  readonly #find: (name: string) => InlineHandler<Tx> | undefined;
  readonly #enqueued: { readonly name: string; readonly payload: unknown }[] = [];

  /** `find` — обработчик по имени задачи; нет обработчика — enqueue бросает. */
  constructor(find: (name: string) => InlineHandler<Tx> | undefined) {
    this.#find = find;
  }

  async enqueue(tx: Tx, job: InlineJob, payload: unknown): Promise<void> {
    const handler = this.#find(job.name);
    if (handler === undefined) {
      throw new Error(`InlineJobs: нет обработчика задачи ${job.name} — передайте его в find.`);
    }
    this.#enqueued.push({ name: job.name, payload });
    await handler(tx, payload);
  }

  /** Ожидающих задач у InlineJobs не бывает: каждая выполнена при постановке, удалять нечего (PRIV-06). */
  async discardHousehold(_householdId: string): Promise<number> {
    return 0;
  }

  /** Поставленные задачи по порядку (для утверждений теста). */
  get enqueued(): readonly { readonly name: string; readonly payload: unknown }[] {
    return [...this.#enqueued];
  }
}
