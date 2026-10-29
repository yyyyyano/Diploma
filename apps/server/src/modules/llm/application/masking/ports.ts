// Маскирование перед облаком (PRIV-03, ARCHITECTURE §8.1): порты. Реализация — masker.ts (правила, склонённый словарь
// имён пользователя, NER), обёртка модели — masked-model.ts.
import type { Scope } from "@kosht/kernel";

/** Замаскированный текст и таблица обратной подстановки (метка → исходное значение). */
export interface Masked {
  readonly text: string;
  readonly replacements: ReadonlyMap<string, string>;
}

/**
 * Один вызов модели: метки сквозные на весь промпт (одно значение — одна метка) и таблица подстановки общая — ответ
 * демаскируется по ней. Сессия живёт ровно один вызов модели; между вызовами метки не переносятся.
 */
export interface MaskSession {
  mask(text: string): Promise<string>;
  readonly replacements: ReadonlyMap<string, string>;
}

export interface Masker {
  /** Заменить имена, счета, карты, телефоны, email, паспорт и адреса метками ([ИМЯ_1], [КАРТА_1]…). */
  mask(scope: Scope, text: string): Promise<Masked>;
  /** Новая сессия на один вызов модели (много кусков промпта — одна нумерация меток). */
  session(scope: Scope): MaskSession;
  /** Вернуть исходные значения на место меток. */
  unmask(text: string, replacements: ReadonlyMap<string, string>): string;
}

/** Порт словаря имён пользователя: реализация — `platform.knownNames` (источник даёт profile). */
export interface KnownNames {
  /** Имена людей из профиля и фактов пользователя (во всех падежах — склоняет маскировщик). */
  names(scope: Scope): Promise<readonly string[]>;
}

export type { NameRecognizer } from "../ports.ts";
