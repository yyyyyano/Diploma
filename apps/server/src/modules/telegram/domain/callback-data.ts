// Данные кнопок (TG-03, TG-04, NOTIF-05, TG-07): Telegram даёт на `callback_data` 64 байта, поэтому — короткий вид действия и
// один короткий аргумент: uuid сущности (2 + 36 = 38 байт), слово команды или 12 знаков хэша модели. Больше в кнопке ничего нет:
// «чьё» это, решает scope из привязки чата, а владелец сущности проверяется в сценарии через `s` (чужой id — NOT_FOUND, SEC-04).
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const CALLBACK_ACTIONS = {
  "receipt-confirm": "rk",
  "receipt-edit": "re",
  "receipt-cancel": "rx",
  "statement-import": "si",
  "statement-cancel": "sx",
  "decision-yes": "dy",
  "decision-no": "dn",
  /** «Отменить» под уведомлением: токен отмены `actions`. */
  undo: "un",
  /** «Показать лимиты», «Сбросить пароль», «Выбрать модель»: быстрая команда по слову. */
  command: "cm",
  /** Выбор модели: 12 знаков хэша id модели или `auto`. */
  model: "md",
} as const;

export type CallbackAction = keyof typeof CALLBACK_ACTIONS;

/** Какой аргумент допустим у действия. */
const ARGUMENT: Readonly<Record<CallbackAction, RegExp>> = {
  "receipt-confirm": UUID,
  "receipt-edit": UUID,
  "receipt-cancel": UUID,
  "statement-import": UUID,
  "statement-cancel": UUID,
  "decision-yes": UUID,
  "decision-no": UUID,
  undo: UUID,
  command: /^(?:balance|week|limits|password|model)$/,
  model: /^(?:auto|[0-9a-f]{12})$/,
};

export interface Callback {
  readonly action: CallbackAction;
  /** uuid, слово команды или метка модели — по виду действия. */
  readonly id: string;
}

const BY_CODE = new Map<string, CallbackAction>(
  (Object.entries(CALLBACK_ACTIONS) as [CallbackAction, string][]).map(([action, code]) => [
    code,
    action,
  ]),
);

export function encodeCallback(callback: Callback): string {
  if (!ARGUMENT[callback.action].test(callback.id)) {
    throw new RangeError("Данные кнопки: аргумент не той формы.");
  }
  return `${CALLBACK_ACTIONS[callback.action]}:${callback.id}`;
}

/** Разбор данных нажатой кнопки; не наша форма — undefined (нажатие молча игнорируется). */
export function decodeCallback(data: string): Callback | undefined {
  const [code, id, ...rest] = data.split(":");
  if (code === undefined || id === undefined || rest.length > 0) return undefined;
  const action = BY_CODE.get(code);
  if (action === undefined || !ARGUMENT[action].test(id)) return undefined;
  return { action, id };
}

/** Короткая метка модели для кнопки: id модели длиннее 64 байт, поэтому в кнопке — 12 знаков его SHA-256. */
export function modelTag(modelId: string): string {
  return createHash("sha256").update(modelId).digest("hex").slice(0, 12);
}
