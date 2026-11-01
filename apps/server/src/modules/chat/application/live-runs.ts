// Какие ответы сейчас пишутся этим процессом (CHAT-02, ARCHITECTURE §8.3): строка «идёт» в БД без живого запуска —
// процесс упал или запуск оборвался, — и при чтении она сохраняется как «оборван». Запуск попадает сюда ДО записи
// строки: иначе чтение между коммитом и стартом запуска приняло бы свежий ответ за зависший. Ключ — домохозяйство и
// id ответа: чужое домохозяйство ответа не видит.
interface Live {
  readonly conversationId: string;
  readonly controller: AbortController;
}

export interface LiveRuns {
  add(householdId: string, messageId: string, live: Live): void;
  remove(householdId: string, messageId: string): void;
  has(householdId: string, messageId: string): boolean;
  /** Остановить все ответы диалога (удаление диалога): модель не должна писать в пустоту. */
  abortConversation(householdId: string, conversationId: string): void;
}

const keyOf = (householdId: string, messageId: string) => `${householdId}:${messageId}`;

export function createLiveRuns(): LiveRuns {
  const live = new Map<string, Live & { readonly householdId: string }>();
  return {
    add: (householdId, messageId, run) =>
      void live.set(keyOf(householdId, messageId), { ...run, householdId }),
    remove: (householdId, messageId) => void live.delete(keyOf(householdId, messageId)),
    has: (householdId, messageId) => live.has(keyOf(householdId, messageId)),
    abortConversation(householdId, conversationId) {
      for (const run of live.values()) {
        if (run.householdId === householdId && run.conversationId === conversationId) {
          run.controller.abort();
        }
      }
    },
  };
}
