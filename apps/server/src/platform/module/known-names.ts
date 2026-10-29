// Словарь имён пользователя для маскирования (PRIV-03, ADR-0009): имена людей из профиля и фактов. Знает модуль
// profile (T-024): он регистрирует источник при старте — по образцу ConsentSource. Шлюз llm маскирует имена из этого
// словаря во всех падежах; пока источника нет, словарь пуст (остаются правила и NER).
import type { Scope } from "@kosht/kernel";

/** Имена людей пользователя scope: «Сергей Иванов», «Анна» — в начальной форме; склоняет маскировщик. */
export type KnownNamesSource = (scope: Scope) => Promise<readonly string[]>;

export interface KnownNamesRegistry {
  /** Подключить источник; он один на процесс — второй вызов — ошибка при старте. */
  register(source: KnownNamesSource): void;
  /** Имена пользователя; источника нет — пусто. */
  names(scope: Scope): Promise<readonly string[]>;
}

export function createKnownNamesRegistry(): KnownNamesRegistry {
  let source: KnownNamesSource | undefined;
  return {
    register(next) {
      if (source !== undefined) throw new Error("Источник имён пользователя уже зарегистрирован.");
      source = next;
    },
    async names(scope) {
      return source === undefined ? [] : source(scope);
    },
  };
}
