// Перепроверка scope из конверта задачи (ARCHITECTURE §5, §6.4; SEC-04): между постановкой и выполнением
// пользователя могли удалить или перевести в другое домохозяйство. Кто пользователь — знает модуль входа
// (identity, T-009): он регистрирует проверку при старте. Пока проверки нет, не проходит никто — задача
// отбрасывается с записью в лог, а не выполняется «на веру».
import type { HouseholdId, UserId } from "@kosht/kernel";

/** Владелец задачи из конверта — ещё не Scope: Scope рождается только после проверки. */
export interface ScopeCandidate {
  readonly userId: UserId;
  readonly householdId: HouseholdId;
}

/** Пользователь существует и состоит в этом домохозяйстве. */
export type ScopeVerifier = (candidate: ScopeCandidate) => Promise<boolean>;

export interface ScopeVerifierRegistry {
  /** Подключить проверку; она одна на процесс — второй вызов — ошибка при старте. */
  register(verifier: ScopeVerifier): void;
  /** Проходит ли владелец; проверки нет — false. */
  verify(candidate: ScopeCandidate): Promise<boolean>;
}

export function createScopeVerifierRegistry(): ScopeVerifierRegistry {
  let source: ScopeVerifier | undefined;
  return {
    register(verifier) {
      if (source !== undefined) throw new Error("Проверка scope задач уже зарегистрирована.");
      source = verifier;
    },
    async verify(candidate) {
      return source === undefined ? false : source(candidate);
    },
  };
}
