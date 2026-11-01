// Код привязки Telegram (TG-02, PRIV-08): 256 бит случайности (≥ 128 по требованию) в base64url — Telegram пропускает в
// `/start <код>` только A–Z, a–z, 0–9, «_» и «-» до 64 знаков; в базе — только SHA-256 кода, сам код живёт в ссылке.
import { createHash, randomBytes } from "node:crypto";

const CODE_BYTES = 32;
/** base64url от 32 байт — 43 знака. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newLinkCode(): string {
  return randomBytes(CODE_BYTES).toString("base64url");
}

export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Код из текста «/start …» бота или undefined (нет аргумента, чужая форма — отказ без обращения к базе). */
export function codeFromStart(argument: string): string | undefined {
  const code = argument.trim();
  return CODE_PATTERN.test(code) ? code : undefined;
}

/** Ссылка на бота со скрытым кодом: пользователь нажимает «Старт», вводить ничего не нужно. */
export function deepLink(botName: string, code: string): string {
  return `https://t.me/${botName}?start=${code}`;
}
