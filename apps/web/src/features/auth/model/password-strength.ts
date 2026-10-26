// Надёжность пароля на форме регистрации (design/screens/Register.dc.html, SEC-01): своя простая эвристика без
// зависимостей. Требования — длина от 12 (SPEC сильнее макета с его «от 8»), буквы и цифры, не совпадает с email и не
// содержит его имя; оценка — «слабый / средний / надёжный» по длине и разнообразию символов. Сервер проверяет только
// длину (контракт NewPassword); остальное — подсказка до отправки.

export const MIN_PASSWORD_LENGTH = 12;

export type StrengthLevel = "none" | "weak" | "medium" | "strong";

export interface PasswordCheck {
  readonly rules: { readonly length: boolean; readonly mix: boolean; readonly notEmail: boolean };
  readonly level: StrengthLevel;
  /** Сколько из 4 делений шкалы закрашено. */
  readonly filled: 0 | 1 | 2 | 3 | 4;
  /** Все требования выполнены. */
  readonly ok: boolean;
}

const LETTER = /\p{L}/u;
const DIGIT = /\d/;
const OTHER = /[^\p{L}\d]/u;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;

export function checkPassword(password: string, email: string): PasswordCheck {
  const login = email.trim().toLowerCase().split("@")[0] ?? "";
  const lower = password.toLowerCase();
  const rules = {
    length: password.length >= MIN_PASSWORD_LENGTH,
    mix: LETTER.test(password) && DIGIT.test(password),
    notEmail:
      password.length > 0 &&
      lower !== email.trim().toLowerCase() &&
      !(login.length > 3 && lower.includes(login)),
  };
  const score = [
    password.length >= 8,
    rules.length,
    rules.mix,
    OTHER.test(password),
    UPPER.test(password) && LOWER.test(password),
  ].filter(Boolean).length;
  if (password.length === 0) return { rules, level: "none", filled: 0, ok: false };
  const level: StrengthLevel = score <= 1 ? "weak" : score <= 3 ? "medium" : "strong";
  const filled = Math.max(1, Math.min(4, Math.ceil((score * 4) / 5))) as PasswordCheck["filled"];
  return { rules, level, filled, ok: rules.length && rules.mix && rules.notEmail };
}
