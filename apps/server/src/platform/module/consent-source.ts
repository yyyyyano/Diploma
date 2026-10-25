// Облачное согласие (PRIV-02, ADR-0009): можно ли отправлять данные пользователя облачной модели. Знает модуль
// согласий (privacy, T-012): он регистрирует источник при старте — по образцу ScopeVerifier. Пока источника нет,
// облако запрещено всем: цепочка шлюза llm — только локальные модели.
import type { Scope } from "@kosht/kernel";

/** Дал ли пользователь scope облачное согласие (и не отозвал его). */
export type ConsentSource = (scope: Scope) => Promise<boolean>;

export interface ConsentRegistry {
  /** Подключить источник; он один на процесс — второй вызов — ошибка при старте. */
  register(source: ConsentSource): void;
  /** Облако разрешено; источника нет — false. */
  cloudAllowed(scope: Scope): Promise<boolean>;
}

export function createConsentRegistry(): ConsentRegistry {
  let source: ConsentSource | undefined;
  return {
    register(next) {
      if (source !== undefined) throw new Error("Источник облачного согласия уже зарегистрирован.");
      source = next;
    },
    async cloudAllowed(scope) {
      return source === undefined ? false : source(scope);
    },
  };
}
