// Очередь на чат (TG-05): обработчик обновления не держит опрос Telegram — долгая работа (агент, распознавание) идёт в
// очереди процесса, по одной на чат (порядок сообщений сохраняется, разные чаты не ждут друг друга). Остановка процесса
// ждёт начатое (`drain`).
export interface ChatQueue {
  /** Поставить работу в очередь чата; результат — когда она выполнена (ошибка работы в очередь не попадает). */
  run(chatId: number, work: () => Promise<void>): Promise<void>;
  /** Дождаться всего, что поставлено к этому моменту и поставится по ходу. */
  drain(): Promise<void>;
}

/** `onError` — запись в лог: ошибка работы, дошедшая до очереди, — сбой программы, а не ответ пользователю. */
export function createChatQueue(onError: (error: unknown) => void): ChatQueue {
  const tails = new Map<number, Promise<void>>();
  return {
    run(chatId, work) {
      const previous = tails.get(chatId) ?? Promise.resolve();
      // Сбой одной работы не ломает очередь: следующая идёт своим чередом, ошибка — в лог.
      const next = previous.then(work, work).catch(onError);
      tails.set(chatId, next);
      void next.then(() => {
        if (tails.get(chatId) === next) tails.delete(chatId);
      });
      return next;
    },
    async drain() {
      while (tails.size > 0) await Promise.all(tails.values());
    },
  };
}
