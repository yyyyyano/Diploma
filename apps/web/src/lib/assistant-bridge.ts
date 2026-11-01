// Мост «спросить ассистента» (CHAT-08, `.claude/rules/frontend-feature.md`): фича не импортирует другую фичу, поэтому
// читалка законов просит открыть ассистента через этот модуль, а панель и страница чата слушают. Вопрос кладётся в
// поле ввода, а не отправляется: человек видит, что уйдёт, и может поправить. Состояние живёт в памяти вкладки
// (данные пользователя в localStorage нельзя) и сбрасывается выходом.
import type { PageContext } from "@kosht/contract";

export interface BridgeState {
  /** Номер просьбы открыть ассистента: растёт при каждом `open`, по нему слушатели отличают новую просьбу. */
  readonly openRequest: number;
  /** Вопрос для поля ввода, ещё не взятый чатом. */
  readonly pendingQuestion: string | undefined;
  /** Последняя страница, не являющаяся чатом: страница `/assistant` показывает её контекст (CHAT-08, телефон). */
  readonly lastPage:
    | { readonly context: PageContext; readonly page: string | undefined }
    | undefined;
}

type Listener = () => void;

export interface AssistantBridge {
  /** Открыть ассистента (панель на компьютере, страница на телефоне); `question` — в поле ввода. */
  readonly open: (question?: string) => void;
  /** Взять отложенный вопрос: после этого его в мосту нет. */
  readonly takeQuestion: () => string | undefined;
  /** Запомнить страницу, с которой пользователь может открыть чат. */
  readonly rememberPage: (page: NonNullable<BridgeState["lastPage"]>) => void;
  /** Забыть всё (выход из аккаунта, смена пользователя). */
  readonly reset: () => void;
  readonly subscribe: (listener: Listener) => () => void;
  readonly getState: () => BridgeState;
}

const EMPTY: BridgeState = { openRequest: 0, pendingQuestion: undefined, lastPage: undefined };

export function createAssistantBridge(): AssistantBridge {
  let state = EMPTY;
  const listeners = new Set<Listener>();
  const set = (next: BridgeState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    open: (question) =>
      set({ ...state, openRequest: state.openRequest + 1, pendingQuestion: question }),
    takeQuestion() {
      const question = state.pendingQuestion;
      if (question !== undefined) state = { ...state, pendingQuestion: undefined };
      return question;
    },
    rememberPage: (page) => {
      if (state.lastPage?.context === page.context) return;
      set({ ...state, lastPage: page });
    },
    reset: () => set(EMPTY),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,
  };
}

/** Мост вкладки. */
export const assistantBridge = createAssistantBridge();
