// Маскирование перед облаком (PRIV-03, ARCHITECTURE §8.1): интерфейсы — здесь, реализация (правила, склонённый
// словарь имён, локальная NER, демаскирование текста, потока и аргументов инструментов) — T-024.
import type { Scope } from "@kosht/kernel";

/** Замаскированный текст и таблица обратной подстановки (метка → исходное значение). */
export interface Masked {
  readonly text: string;
  readonly replacements: ReadonlyMap<string, string>;
}

export interface Masker {
  /** Заменить имена, номера счетов и карт, телефоны и email метками ([ИМЯ_1], [КАРТА_1]…). */
  mask(scope: Scope, text: string): Promise<Masked>;
  /** Вернуть исходные значения на место меток. */
  unmask(text: string, replacements: ReadonlyMap<string, string>): string;
}

/** Порт словаря имён пользователя (реализацию подставляет profile через реестр, T-024). */
export interface KnownNames {
  /** Имена людей из профиля и фактов пользователя (во всех падежах — склоняет маскировщик). */
  names(scope: Scope): Promise<readonly string[]>;
}
